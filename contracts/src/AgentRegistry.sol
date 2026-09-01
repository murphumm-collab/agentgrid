// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StakeCreditManager} from "./StakeCreditManager.sol";

interface IAgentSelectionConflicts {
    function isAgentSelectionConflict(uint256 taskId, address candidate, bool evaluatorPanel) external view returns (bool);
}

/// @notice Binds one agent wallet to one live, on-chain stake position.
/// A withdrawal request immediately removes eligibility, before funds leave.
contract AgentRegistry {
    uint8 public constant CAPABILITY_EXECUTE = 1;
    uint8 public constant CAPABILITY_TEST = 2;
    uint8 public constant CAPABILITY_EVALUATE = 4;
    uint8 public constant CAPABILITY_VERIFY_AUTOMATED = 8;
    uint8 public constant CAPABILITY_VERIFY_ARTIFACT = 16;
    uint8 public constant CAPABILITY_VERIFY_DATA = 32;
    uint8 public constant CAPABILITY_VERIFY_EXTERNAL = 64;
    uint8 public constant CAPABILITY_VERIFY_HUMAN = 128;
    uint8 public constant BASE_CAPABILITIES = 7;
    uint8 public constant ALL_CAPABILITIES = type(uint8).max;
    uint16 public constant INITIAL_QUALITY_BPS = 5_000;
    uint16 public constant PAID_POOL_MINIMUM_QUALITY_BPS = 2_500;
    uint16 public constant SUCCESS_GAIN_BPS = 200;
    uint16 public constant FAILURE_LOSS_BPS = 500;
    uint16 public constant SEVERE_FAILURE_LOSS_BPS = 1_500;
    uint64 public constant QUALITY_COOLDOWN = 30 days;
    uint8 public constant PERMANENT_BAN_SEVERE_FAULTS = 3;
    uint8 public constant MAX_POSITIVE_OUTCOMES_PER_EPOCH = 10;
    uint64 public constant QUALITY_EPOCH_DURATION = 30 days;

    struct RoleQuality {
        uint16 scoreBps;
        uint32 outcomeCount;
        uint8 severeFaults;
        uint64 cooldownUntil;
        bool banned;
    }

    StakeCreditManager public immutable stakeManager;
    mapping(address => uint256) public agentPosition;
    mapping(uint256 => address) public positionAgent;
    mapping(address => uint8) public agentCapabilities;
    mapping(address => bool) public agentActive;
    mapping(address => mapping(uint8 => RoleQuality)) private roleQuality;
    mapping(address => uint8) public outcomeReporterRoles;
    mapping(bytes32 => bool) public consumedOutcome;
    mapping(bytes32 => bool) public consumedRehabilitation;
    mapping(address => mapping(uint8 => mapping(uint256 => uint8))) public positiveOutcomesInEpoch;
    address[] private registeredAgents;
    bytes32 public registryHash;

    error Unauthorized();
    error PositionAlreadyBound();
    error ExistingRegistrationActive();
    error InvalidRole();
    error InvalidOutcome();
    error OutcomeAlreadyConsumed();

    event AgentRegistered(address indexed agent, uint256 indexed positionId, uint256 stake);
    event AgentCapabilitiesUpdated(address indexed agent, uint8 capabilities);
    event AgentStatusUpdated(address indexed agent, bool active);
    event OutcomeReporterUpdated(address indexed reporter, uint8 roleMask);
    event AgentQualityUpdated(
        address indexed agent, uint8 indexed role, bytes32 indexed outcomeId, uint16 scoreBps, uint32 outcomeCount,
        uint8 severeFaults, uint64 cooldownUntil, bool banned, bool success, bool severe,
        bytes32 evidenceHash
    );
    event AgentQualityOutcomeIgnored(address indexed agent, uint8 indexed role, bytes32 indexed outcomeId, bytes32 evidenceHash, bytes32 reason);
    event AgentRoleRehabilitated(address indexed agent, uint8 indexed role, bytes32 indexed evidenceHash);

    constructor(StakeCreditManager stakeManager_) {
        stakeManager = stakeManager_;
    }

    /// @notice Bootstrap authority must be replaced by a governed timelock in a
    /// production deployment. Reporters can only write outcomes for named roles.
    function setOutcomeReporter(address reporter, uint8 roleMask) external {
        if (
            msg.sender != stakeManager.owner() || reporter == address(0) || reporter.code.length == 0 ||
            roleMask == 0 || (roleMask & ~BASE_CAPABILITIES) != 0 || outcomeReporterRoles[reporter] != 0
        ) revert Unauthorized();
        outcomeReporterRoles[reporter] = roleMask;
        emit OutcomeReporterUpdated(reporter, roleMask);
    }

    function register(uint256 positionId) external {
        // Backwards-compatible role registration. Verification specialities are
        // never granted implicitly; an agent must declare them explicitly.
        _register(positionId, BASE_CAPABILITIES);
    }

    function registerWithCapabilities(uint256 positionId, uint8 capabilities) external {
        _register(positionId, capabilities);
    }

    function _register(uint256 positionId, uint8 capabilities) private {
        if ((capabilities & BASE_CAPABILITIES) == 0) revert Unauthorized();
        if (stakeManager.ownerOf(positionId) != msg.sender) revert Unauthorized();
        if (positionAgent[positionId] != address(0) && positionAgent[positionId] != msg.sender) revert PositionAlreadyBound();
        uint256 previous = agentPosition[msg.sender];
        if (previous != 0 && previous != positionId) {
            if (isEligible(msg.sender)) revert ExistingRegistrationActive();
            positionAgent[previous] = address(0);
        }
        (address owner, uint256 amount, , , uint256 withdrawalRequestedAt) = stakeManager.positions(positionId);
        if (owner != msg.sender || amount < stakeManager.MINIMUM_STAKE() || withdrawalRequestedAt != 0) revert Unauthorized();
        if (previous == positionId && agentCapabilities[msg.sender] == capabilities && agentActive[msg.sender]) return;
        agentPosition[msg.sender] = positionId;
        positionAgent[positionId] = msg.sender;
        agentCapabilities[msg.sender] = capabilities;
        agentActive[msg.sender] = true;
        if (previous == 0) registeredAgents.push(msg.sender);
        registryHash = keccak256(abi.encode(registryHash, msg.sender, positionId));
        emit AgentRegistered(msg.sender, positionId, amount);
        emit AgentCapabilitiesUpdated(msg.sender, capabilities);
        emit AgentStatusUpdated(msg.sender, true);
    }

    /// @notice Temporarily removes or restores this wallet from every future
    /// evaluator/tester/executor eligibility check without starting withdrawal.
    /// Repeated writes are idempotent and do not perturb the registry snapshot.
    function setActive(bool active) external {
        uint256 positionId = agentPosition[msg.sender];
        if (positionId == 0) revert Unauthorized();
        if (active) {
            (address owner, uint256 amount, , , uint256 withdrawalRequestedAt) = stakeManager.positions(positionId);
            if (owner != msg.sender || amount < stakeManager.MINIMUM_STAKE() || withdrawalRequestedAt != 0) revert Unauthorized();
        }
        if (agentActive[msg.sender] == active) return;
        agentActive[msg.sender] = active;
        registryHash = keccak256(abi.encode(registryHash, msg.sender, positionId, active));
        emit AgentStatusUpdated(msg.sender, active);
    }

    function agentCount() external view returns (uint256) {
        return registeredAgents.length;
    }

    function agentAt(uint256 index) external view returns (address) {
        return registeredAgents[index];
    }

    function isEligible(address agent) public view returns (bool) {
        if (!agentActive[agent]) return false;
        uint256 positionId = agentPosition[agent];
        if (positionId == 0) return false;
        (address owner, uint256 amount, , , uint256 withdrawalRequestedAt) = stakeManager.positions(positionId);
        return owner == agent && amount >= stakeManager.MINIMUM_STAKE() && withdrawalRequestedAt == 0;
    }

    function isEligibleFor(address agent, uint8 capability) public view returns (bool) {
        if (capability == 0 || (agentCapabilities[agent] & capability) != capability || !isEligible(agent)) return false;
        uint8 role = _roleForCapability(capability);
        RoleQuality memory quality = roleQuality[agent][role];
        uint16 score = quality.scoreBps == 0 ? INITIAL_QUALITY_BPS : quality.scoreBps;
        return !quality.banned && quality.cooldownUntil <= block.timestamp && score >= PAID_POOL_MINIMUM_QUALITY_BPS;
    }

    /// @notice Only canonical protocol contracts may report objective outcomes.
    /// Validator dissent is not a failure; callers must only submit timeouts,
    /// final task outcomes, or upheld arbitration evidence.
    function recordOutcome(
        address agent, uint8 role, bytes32 contextId, bytes32 outcomeType,
        bool success, bool severe, bytes32 evidenceHash
    ) external {
        if (!_validRole(role)) revert InvalidRole();
        if ((outcomeReporterRoles[msg.sender] & role) == 0) revert Unauthorized();
        if (agentPosition[agent] == 0 || contextId == bytes32(0) || outcomeType == bytes32(0) || evidenceHash == bytes32(0) || (success && severe)) revert InvalidOutcome();
        bytes32 outcomeId = keccak256(abi.encode(block.chainid, address(this), agent, role, contextId, outcomeType));
        if (consumedOutcome[outcomeId]) revert OutcomeAlreadyConsumed();
        consumedOutcome[outcomeId] = true;
        RoleQuality storage quality = roleQuality[agent][role];
        if (quality.banned) {
            emit AgentQualityOutcomeIgnored(agent, role, outcomeId, evidenceHash, keccak256("ROLE_ALREADY_BANNED"));
            return;
        }
        uint16 score = quality.scoreBps == 0 ? INITIAL_QUALITY_BPS : quality.scoreBps;
        quality.outcomeCount += 1;
        if (success) {
            uint256 epoch = block.timestamp / QUALITY_EPOCH_DURATION;
            uint8 positives = positiveOutcomesInEpoch[agent][role][epoch];
            if (positives >= MAX_POSITIVE_OUTCOMES_PER_EPOCH) {
                quality.scoreBps = score;
                registryHash = keccak256(abi.encode(registryHash, agent, role, score, quality.outcomeCount, evidenceHash, "POSITIVE_EPOCH_CAP"));
                emit AgentQualityOutcomeIgnored(agent, role, outcomeId, evidenceHash, keccak256("POSITIVE_EPOCH_CAP"));
                emit AgentQualityUpdated(
                    agent, role, outcomeId, score, quality.outcomeCount, quality.severeFaults,
                    quality.cooldownUntil, quality.banned, true, false, evidenceHash
                );
                return;
            }
            positiveOutcomesInEpoch[agent][role][epoch] = positives + 1;
            uint256 increased = uint256(score) + SUCCESS_GAIN_BPS;
            quality.scoreBps = uint16(increased > BPS() ? BPS() : increased);
        } else {
            uint16 loss = severe ? SEVERE_FAILURE_LOSS_BPS : FAILURE_LOSS_BPS;
            quality.scoreBps = score > loss ? score - loss : 1;
            if (severe) {
                quality.severeFaults += 1;
                if (quality.severeFaults >= PERMANENT_BAN_SEVERE_FAULTS) quality.banned = true;
            }
            if (quality.scoreBps < PAID_POOL_MINIMUM_QUALITY_BPS) quality.cooldownUntil = uint64(block.timestamp + QUALITY_COOLDOWN);
        }
        registryHash = keccak256(abi.encode(registryHash, agent, role, quality.scoreBps, quality.outcomeCount, evidenceHash));
        emit AgentQualityUpdated(
            agent, role, outcomeId, quality.scoreBps, quality.outcomeCount, quality.severeFaults,
            quality.cooldownUntil, quality.banned, success, severe, evidenceHash
        );
    }

    /// @notice Evidence-bound governance appeal. It never silently restores a
    /// high score: the Agent returns at the paid-pool floor and must earn trust.
    function rehabilitateRole(address agent, uint8 role, bytes32 evidenceHash) external {
        if (!_validRole(role)) revert InvalidRole();
        if ((outcomeReporterRoles[msg.sender] & role) == 0) revert Unauthorized();
        RoleQuality storage quality = roleQuality[agent][role];
        bytes32 rehabilitationId = keccak256(abi.encode(block.chainid, address(this), agent, role, evidenceHash, "REHABILITATION"));
        if (consumedRehabilitation[rehabilitationId]) revert OutcomeAlreadyConsumed();
        if (agentPosition[agent] == 0 || evidenceHash == bytes32(0) || (!quality.banned && quality.cooldownUntil == 0)) revert InvalidOutcome();
        consumedRehabilitation[rehabilitationId] = true;
        quality.scoreBps = PAID_POOL_MINIMUM_QUALITY_BPS;
        quality.cooldownUntil = 0;
        quality.banned = false;
        if (quality.severeFaults >= PERMANENT_BAN_SEVERE_FAULTS) quality.severeFaults = PERMANENT_BAN_SEVERE_FAULTS - 1;
        registryHash = keccak256(abi.encode(registryHash, agent, role, quality.scoreBps, evidenceHash, "REHABILITATED"));
        emit AgentRoleRehabilitated(agent, role, evidenceHash);
    }

    function qualityOf(address agent, uint8 role) external view returns (RoleQuality memory quality) {
        if (!_validRole(role)) revert InvalidRole();
        quality = roleQuality[agent][role];
        if (quality.scoreBps == 0) quality.scoreBps = INITIAL_QUALITY_BPS;
    }

    function qualityMultiplierBps(address agent, uint8 role) public view returns (uint16) {
        if (!_validRole(role)) revert InvalidRole();
        uint16 score = _effectiveScore(agent, role);
        return uint16(8_000 + (uint256(score) * 4_000) / 10_000);
    }

    /// @notice A non-zero fairness floor prevents a small incumbent set from
    /// permanently monopolizing work while still favoring proven Agents.
    function selectionWeight(address agent, uint8 capability) external view returns (uint256) {
        if (!isEligibleFor(agent, capability)) return 0;
        uint8 role = _roleForCapability(capability);
        return 1_000 + _effectiveScore(agent, role);
    }

    /// @notice Deterministic quality-weighted sampling with a fairness floor.
    /// The calling TaskRegistry supplies a read-only conflict predicate so the
    /// quality registry never needs task-specific storage.
    function selectWeightedTaskCandidate(
        uint256 taskId, bytes32 proof, uint8 slot, uint256 candidateCount,
        uint8 capability, address[3] calldata selected, uint8 selectedCount,
        bool evaluatorPanel
    ) external view returns (address winner) {
        if (candidateCount == 0 || candidateCount > registeredAgents.length) return address(0);
        uint256 totalWeight;
        for (uint256 i; i < candidateCount; ++i) {
            address candidate = registeredAgents[i];
            if (_selected(candidate, selected, selectedCount) || !isEligibleFor(candidate, capability)) continue;
            if (IAgentSelectionConflicts(msg.sender).isAgentSelectionConflict(taskId, candidate, evaluatorPanel)) continue;
            totalWeight += _selectionWeight(candidate, capability);
        }
        if (totalWeight == 0) return address(0);
        uint256 ticket = uint256(keccak256(abi.encode(proof, slot, "QUALITY_WEIGHTED_SELECTION"))) % totalWeight;
        uint256 cumulative;
        for (uint256 i; i < candidateCount; ++i) {
            address candidate = registeredAgents[i];
            if (_selected(candidate, selected, selectedCount) || !isEligibleFor(candidate, capability)) continue;
            if (IAgentSelectionConflicts(msg.sender).isAgentSelectionConflict(taskId, candidate, evaluatorPanel)) continue;
            cumulative += _selectionWeight(candidate, capability);
            if (ticket < cumulative) return candidate;
        }
    }

    function _selectionWeight(address agent, uint8 capability) private view returns (uint256) {
        uint8 role = _roleForCapability(capability);
        return 1_000 + _effectiveScore(agent, role);
    }

    function _effectiveScore(address agent, uint8 role) private view returns (uint16 score) {
        RoleQuality storage quality = roleQuality[agent][role];
        score = quality.scoreBps == 0 ? INITIAL_QUALITY_BPS : quality.scoreBps;
        // Fewer than three independent outcomes may reduce trust immediately,
        // but cannot enter the priority-selection or bonus-reward tier.
        if (quality.outcomeCount < 3 && score > INITIAL_QUALITY_BPS) score = INITIAL_QUALITY_BPS;
    }

    function _selected(address candidate, address[3] calldata selected, uint8 selectedCount) private pure returns (bool) {
        for (uint8 i; i < selectedCount; ++i) if (selected[i] == candidate) return true;
        return false;
    }

    function _roleForCapability(uint8 capability) private pure returns (uint8) {
        if ((capability & CAPABILITY_TEST) != 0) return CAPABILITY_TEST;
        if ((capability & CAPABILITY_EVALUATE) != 0) return CAPABILITY_EVALUATE;
        if ((capability & CAPABILITY_EXECUTE) != 0) return CAPABILITY_EXECUTE;
        revert InvalidRole();
    }

    function _validRole(uint8 role) private pure returns (bool) {
        return role == CAPABILITY_EXECUTE || role == CAPABILITY_TEST || role == CAPABILITY_EVALUATE;
    }

    function BPS() private pure returns (uint16) {
        return 10_000;
    }
}
