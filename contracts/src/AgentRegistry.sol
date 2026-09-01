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
    uint8 public constant MAX_POSITIVE_OUTCOMES_PER_RELATIONSHIP_EPOCH = 1;
    uint64 public constant QUALITY_EPOCH_DURATION = 30 days;
    uint256 public constant MINIMUM_QUALITY_TASK_REWARD = 10 ether;

    struct RoleQuality {
        uint16 scoreBps;
        uint32 outcomeCount;
        uint8 severeFaults;
        uint64 cooldownUntil;
        bool banned;
    }

    struct AgentStateCheckpoint {
        uint64 version;
        uint256 positionId;
        uint8 capabilities;
        bool active;
    }

    struct QualityCheckpoint {
        uint64 version;
        RoleQuality quality;
        uint32 independentPositiveOutcomes;
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
    mapping(address => mapping(uint8 => uint32)) public independentPositiveOutcomeCount;
    mapping(bytes32 => bool) public creditedQualityRelationship;
    mapping(bytes32 => mapping(uint256 => uint8)) public positiveRelationshipOutcomesInEpoch;
    mapping(address => AgentStateCheckpoint[]) private agentStateCheckpoints;
    mapping(address => mapping(uint8 => QualityCheckpoint[])) private qualityCheckpoints;
    address[] private registeredAgents;
    bytes32 public registryHash;
    uint64 public registryVersion;

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
    event AgentQualityRelationshipCredited(
        address indexed agent, uint8 indexed role, bytes32 indexed relationshipId,
        address publisher, uint256 taskId, uint32 independentPositiveOutcomes
    );
    event AgentRoleRehabilitated(address indexed agent, uint8 indexed role, bytes32 indexed evidenceHash);
    event RegistrySnapshotAdvanced(uint64 indexed version, bytes32 indexed registryHash);

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
        _advanceRegistry(keccak256(abi.encode("REGISTER", msg.sender, positionId, capabilities)));
        _writeStateCheckpoint(msg.sender);
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
        _advanceRegistry(keccak256(abi.encode("ACTIVE", msg.sender, positionId, active)));
        _writeStateCheckpoint(msg.sender);
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
        _recordOutcome(agent, role, 0, address(0), 0, contextId, outcomeType, success, severe, evidenceHash);
    }

    /// @notice Canonical task outcomes carry publisher and economic context from
    /// the protocol reporter. Positive quality cannot be farmed by tiny tasks or
    /// repeated relationships; negative outcomes are never suppressed.
    function recordTaskOutcome(
        address agent, uint8 role, uint256 taskId, address publisher, uint256 taskReward,
        bytes32 contextId, bytes32 outcomeType, bool success, bool severe, bytes32 evidenceHash
    ) external {
        _recordOutcome(agent, role, taskId, publisher, taskReward, contextId, outcomeType, success, severe, evidenceHash);
    }

    function _recordOutcome(
        address agent, uint8 role, uint256 taskId, address publisher, uint256 taskReward,
        bytes32 contextId, bytes32 outcomeType, bool success, bool severe, bytes32 evidenceHash
    ) private {
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
            bytes32 relationshipId = keccak256(abi.encode(block.chainid, address(this), publisher, agent, role));
            bytes32 ignoredReason;
            if (taskId == 0 || publisher == address(0)) ignoredReason = keccak256("TASK_CONTEXT_REQUIRED");
            else if (publisher == agent) ignoredReason = keccak256("SELF_DEALING_RELATIONSHIP");
            else if (taskReward < MINIMUM_QUALITY_TASK_REWARD) ignoredReason = keccak256("LOW_VALUE_TASK");
            else if (positiveRelationshipOutcomesInEpoch[relationshipId][epoch] >= MAX_POSITIVE_OUTCOMES_PER_RELATIONSHIP_EPOCH) {
                ignoredReason = keccak256("RELATIONSHIP_EPOCH_CAP");
            }
            if (ignoredReason != bytes32(0)) {
                quality.scoreBps = score;
                _advanceRegistry(keccak256(abi.encode("POSITIVE_RELATIONSHIP_IGNORED", agent, role, taskId, relationshipId, ignoredReason, evidenceHash)));
                _writeQualityCheckpoint(agent, role, quality);
                emit AgentQualityOutcomeIgnored(agent, role, outcomeId, evidenceHash, ignoredReason);
                emit AgentQualityUpdated(
                    agent, role, outcomeId, score, quality.outcomeCount, quality.severeFaults,
                    quality.cooldownUntil, quality.banned, true, false, evidenceHash
                );
                return;
            }
            uint8 positives = positiveOutcomesInEpoch[agent][role][epoch];
            if (positives >= MAX_POSITIVE_OUTCOMES_PER_EPOCH) {
                quality.scoreBps = score;
                _advanceRegistry(keccak256(abi.encode("POSITIVE_EPOCH_CAP", agent, role, score, quality.outcomeCount, evidenceHash)));
                _writeQualityCheckpoint(agent, role, quality);
                emit AgentQualityOutcomeIgnored(agent, role, outcomeId, evidenceHash, keccak256("POSITIVE_EPOCH_CAP"));
                emit AgentQualityUpdated(
                    agent, role, outcomeId, score, quality.outcomeCount, quality.severeFaults,
                    quality.cooldownUntil, quality.banned, true, false, evidenceHash
                );
                return;
            }
            positiveOutcomesInEpoch[agent][role][epoch] = positives + 1;
            positiveRelationshipOutcomesInEpoch[relationshipId][epoch] += 1;
            if (!creditedQualityRelationship[relationshipId]) {
                creditedQualityRelationship[relationshipId] = true;
                independentPositiveOutcomeCount[agent][role] += 1;
                emit AgentQualityRelationshipCredited(
                    agent, role, relationshipId, publisher, taskId, independentPositiveOutcomeCount[agent][role]
                );
            }
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
        _advanceRegistry(keccak256(abi.encode("QUALITY", agent, role, quality.scoreBps, quality.outcomeCount, evidenceHash)));
        _writeQualityCheckpoint(agent, role, quality);
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
        _advanceRegistry(keccak256(abi.encode("REHABILITATED", agent, role, quality.scoreBps, evidenceHash)));
        _writeQualityCheckpoint(agent, role, quality);
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

    /// @notice Returns only the registry-derived request-time weight. This is
    /// deterministic for a frozen version/time and deliberately does not apply
    /// later stake, active, capability or quality safety vetoes, allowing a
    /// paginated accumulator to be built without timing-dependent omissions.
    function frozenSelectionWeightAt(
        address agent, uint8 capability, uint64 snapshotVersion, uint64 snapshotTime
    ) public view returns (uint256) {
        if (
            snapshotVersion == 0 || snapshotVersion > registryVersion || snapshotTime > block.timestamp ||
            capability == 0
        ) return 0;
        AgentStateCheckpoint memory state = _stateAt(agent, snapshotVersion);
        if (!state.active || state.positionId == 0 || (state.capabilities & capability) != capability) return 0;
        uint8 role = _roleForCapability(capability);
        (RoleQuality memory quality, uint32 independentOutcomes) = _qualityAt(agent, role, snapshotVersion);
        uint16 score = quality.scoreBps == 0 ? INITIAL_QUALITY_BPS : quality.scoreBps;
        if (quality.banned || quality.cooldownUntil > snapshotTime || score < PAID_POOL_MINIMUM_QUALITY_BPS) return 0;
        if (independentOutcomes < 3 && score > INITIAL_QUALITY_BPS) score = INITIAL_QUALITY_BPS;
        return 1_000 + score;
    }

    /// @notice Applies current safety vetoes to the immutable request-time
    /// weight. Positive changes cannot improve an old draw; withdrawal,
    /// deactivation, capability removal, cooldown or a ban can still remove an
    /// unsafe/unavailable candidate. The current stake position is read once.
    function selectionWeightAt(
        address agent, uint8 capability, uint64 snapshotVersion, uint64 snapshotTime
    ) public view returns (uint256) {
        if (!isEligibleFor(agent, capability)) return 0;
        return frozenSelectionWeightAt(agent, capability, snapshotVersion, snapshotTime);
    }

    /// @notice Deterministic quality-weighted sampling with a fairness floor.
    /// The calling TaskRegistry supplies a read-only conflict predicate so the
    /// quality registry never needs task-specific storage.
    function selectWeightedTaskCandidate(
        uint256 taskId, bytes32 proof, uint8 slot, uint256 candidateCount,
        uint8 capability, address[3] calldata selected, uint8 selectedCount,
        bool evaluatorPanel, bytes32 snapshot
    ) external view returns (address winner) {
        if (candidateCount == 0 || candidateCount > registeredAgents.length) return address(0);
        uint256 packedSnapshot = uint256(snapshot);
        uint64 snapshotVersion = uint64(packedSnapshot >> 64);
        uint64 snapshotTime = uint64(packedSnapshot);
        uint256 totalWeight;
        for (uint256 i; i < candidateCount; ++i) {
            address candidate = registeredAgents[i];
            if (_selected(candidate, selected, selectedCount)) continue;
            if (IAgentSelectionConflicts(msg.sender).isAgentSelectionConflict(taskId, candidate, evaluatorPanel)) continue;
            totalWeight += selectionWeightAt(candidate, capability, snapshotVersion, snapshotTime);
        }
        if (totalWeight == 0) return address(0);
        uint256 ticket = uint256(keccak256(abi.encode(proof, slot, "QUALITY_WEIGHTED_SELECTION"))) % totalWeight;
        uint256 cumulative;
        for (uint256 i; i < candidateCount; ++i) {
            address candidate = registeredAgents[i];
            if (_selected(candidate, selected, selectedCount)) continue;
            if (IAgentSelectionConflicts(msg.sender).isAgentSelectionConflict(taskId, candidate, evaluatorPanel)) continue;
            cumulative += selectionWeightAt(candidate, capability, snapshotVersion, snapshotTime);
            if (ticket < cumulative) return candidate;
        }
    }

    function _advanceRegistry(bytes32 mutationHash) private {
        registryVersion += 1;
        registryHash = keccak256(abi.encode(registryHash, registryVersion, mutationHash));
        emit RegistrySnapshotAdvanced(registryVersion, registryHash);
    }

    function _writeStateCheckpoint(address agent) private {
        agentStateCheckpoints[agent].push(AgentStateCheckpoint({
            version: registryVersion,
            positionId: agentPosition[agent],
            capabilities: agentCapabilities[agent],
            active: agentActive[agent]
        }));
    }

    function _writeQualityCheckpoint(address agent, uint8 role, RoleQuality storage quality) private {
        qualityCheckpoints[agent][role].push(QualityCheckpoint({
            version: registryVersion,
            quality: quality,
            independentPositiveOutcomes: independentPositiveOutcomeCount[agent][role]
        }));
    }

    function _stateAt(address agent, uint64 version) private view returns (AgentStateCheckpoint memory checkpoint) {
        AgentStateCheckpoint[] storage checkpoints = agentStateCheckpoints[agent];
        uint256 low;
        uint256 high = checkpoints.length;
        while (low < high) {
            uint256 middle = (low + high) / 2;
            if (checkpoints[middle].version <= version) low = middle + 1;
            else high = middle;
        }
        if (low != 0) checkpoint = checkpoints[low - 1];
    }

    function _qualityAt(address agent, uint8 role, uint64 version) private view returns (RoleQuality memory quality, uint32 independentOutcomes) {
        QualityCheckpoint[] storage checkpoints = qualityCheckpoints[agent][role];
        uint256 low;
        uint256 high = checkpoints.length;
        while (low < high) {
            uint256 middle = (low + high) / 2;
            if (checkpoints[middle].version <= version) low = middle + 1;
            else high = middle;
        }
        if (low != 0) {
            quality = checkpoints[low - 1].quality;
            independentOutcomes = checkpoints[low - 1].independentPositiveOutcomes;
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
        if (independentPositiveOutcomeCount[agent][role] < 3 && score > INITIAL_QUALITY_BPS) score = INITIAL_QUALITY_BPS;
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
