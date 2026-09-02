// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StakeCreditManager} from "./StakeCreditManager.sol";

interface IAgentSelectionConflicts {
    function isAgentSelectionConflict(uint256 taskId, address candidate, bool evaluatorPanel) external view returns (bool);
}

/// @notice Binds one Agent identity to a wallet. Pure executors may register
/// without stake; evaluator and validator eligibility remains stake-backed.
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

    struct SelectionPool {
        address requester;
        uint256 taskId;
        uint256 candidateCount;
        uint256 cursor;
        uint256 totalWeight;
        uint256 selectionBlock;
        uint64 snapshotVersion;
        uint64 snapshotTime;
        uint8 capability;
        uint8 selectedCount;
        uint64 drawNonce;
        bool evaluatorPanel;
        bool complete;
        bytes32 candidateSetHash;
        bytes32 entropySeed;
        bytes32 drawProof;
        uint64 exhaustedVersion;
        bytes32 successorPoolId;
    }

    StakeCreditManager public immutable stakeManager;
    mapping(address => uint256) public agentPosition;
    mapping(uint256 => address) public positionAgent;
    mapping(address => uint8) public agentCapabilities;
    mapping(address => bool) public agentActive;
    mapping(address => bool) private registeredAgent;
    mapping(address => bool) private selectionListed;
    mapping(address => mapping(uint8 => RoleQuality)) private roleQuality;
    mapping(address => uint8) public outcomeReporterRoles;
    mapping(bytes32 => bool) public consumedOutcome;
    mapping(bytes32 => bool) public consumedRehabilitation;
    mapping(address => mapping(uint8 => mapping(uint256 => uint8))) public positiveOutcomesInEpoch;
    mapping(address => mapping(uint8 => uint32)) public independentPositiveOutcomeCount;
    mapping(bytes32 => bool) public creditedQualityRelationship;
    mapping(bytes32 => mapping(uint256 => uint8)) public positiveRelationshipOutcomesInEpoch;
    mapping(address => AgentStateCheckpoint[]) internal agentStateCheckpoints;
    mapping(address => mapping(uint8 => QualityCheckpoint[])) private qualityCheckpoints;
    address[] internal registeredAgents;
    bytes32 public registryHash;
    uint64 public registryVersion;
    address public selectionRequester;
    mapping(bytes32 => SelectionPool) public selectionPools;
    mapping(bytes32 => address[]) internal selectionPoolCandidates;
    mapping(bytes32 => uint256[]) internal selectionPoolWeights;
    mapping(bytes32 => uint256[]) internal selectionPoolRemainingWeights;
    mapping(bytes32 => uint256[]) internal selectionPoolFenwick;
    mapping(bytes32 => address[3]) private selectionPoolWinners;

    uint16 public constant MAX_SELECTION_BUILD_PAGE = 64;
    uint8 public constant MAX_SELECTION_PRUNES = 16;
    uint8 public constant SELECTION_POOL_SIZE = 3;
    uint256 public constant SELECTION_ENTROPY_DELAY = 5;

    error Unauthorized();
    error PositionAlreadyBound();
    error ExistingRegistrationActive();
    error InvalidRole();
    error InvalidOutcome();
    error OutcomeAlreadyConsumed();
    error InvalidSelectionPool();

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
    event SelectionRequesterConfigured(address indexed requester);
    event SelectionPoolStarted(
        bytes32 indexed poolId, uint256 indexed taskId, address indexed requester,
        uint256 candidateCount, uint64 snapshotVersion, uint64 snapshotTime,
        uint8 capability, bool evaluatorPanel, bytes32 candidateSetHash
    );
    event SelectionPoolProgress(bytes32 indexed poolId, uint256 cursor, uint256 candidateCount, uint256 totalWeight);
    event SelectionPoolSealed(bytes32 indexed poolId, uint256 indexed taskId, uint256 selectionBlock, uint256 eligibleCandidates, uint256 totalWeight, bool evaluatorPanel);
    event SelectionPoolCandidatePruned(bytes32 indexed poolId, address indexed candidate, uint64 drawNonce);
    event SelectionPoolCandidateSelected(bytes32 indexed poolId, uint256 indexed taskId, address indexed candidate, uint8 slot, bytes32 drawProof);
    event SelectionPoolExhausted(bytes32 indexed poolId, uint256 indexed taskId, uint64 indexed exhaustedVersion, uint8 selectedCount);
    event SelectionPoolRecovered(
        bytes32 indexed exhaustedPoolId, bytes32 indexed successorPoolId, uint256 indexed taskId,
        uint64 exhaustedVersion, uint64 recoveryVersion
    );

    constructor(StakeCreditManager stakeManager_) {
        stakeManager = stakeManager_;
    }

    /// @notice One-time production wiring to TaskRegistry. Construction pages
    /// remain permissionless, while pool creation and draws can only be driven
    /// by the protocol state machine.
    function setSelectionRequester(address requester) external {
        if (
            msg.sender != stakeManager.owner() || requester == address(0) || requester.code.length == 0 ||
            selectionRequester != address(0)
        ) revert Unauthorized();
        selectionRequester = requester;
        emit SelectionRequesterConfigured(requester);
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
        bool stakeFreeExecutor = positionId == 0 && capabilities == CAPABILITY_EXECUTE;
        if (!stakeFreeExecutor) {
            if (stakeManager.ownerOf(positionId) != msg.sender) revert Unauthorized();
            if (positionAgent[positionId] != address(0) && positionAgent[positionId] != msg.sender) revert PositionAlreadyBound();
        }
        uint256 previous = agentPosition[msg.sender];
        if (previous != 0 && previous != positionId) {
            if (isEligible(msg.sender)) revert ExistingRegistrationActive();
            positionAgent[previous] = address(0);
        }
        uint256 amount;
        if (!stakeFreeExecutor) {
            (address owner, uint256 stakedAmount, , , uint256 withdrawalRequestedAt) = stakeManager.positions(positionId);
            if (owner != msg.sender || stakedAmount < stakeManager.MINIMUM_STAKE() || withdrawalRequestedAt != 0) revert Unauthorized();
            amount = stakedAmount;
        }
        if (previous == positionId && agentCapabilities[msg.sender] == capabilities && agentActive[msg.sender]) return;
        agentPosition[msg.sender] = positionId;
        if (positionId != 0) positionAgent[positionId] = msg.sender;
        agentCapabilities[msg.sender] = capabilities;
        agentActive[msg.sender] = true;
        registeredAgent[msg.sender] = true;
        if (positionId != 0 && !selectionListed[msg.sender]) {
            selectionListed[msg.sender] = true;
            registeredAgents.push(msg.sender);
        }
        if (positionId != 0) {
            _advanceRegistry(keccak256(abi.encode("REGISTER", msg.sender, positionId, capabilities)));
            _writeStateCheckpoint(msg.sender);
        }
        emit AgentRegistered(msg.sender, positionId, amount);
        emit AgentCapabilitiesUpdated(msg.sender, capabilities);
        emit AgentStatusUpdated(msg.sender, true);
    }

    /// @notice Temporarily removes or restores this wallet from every future
    /// evaluator/tester/executor eligibility check without starting withdrawal.
    /// Repeated writes are idempotent and do not perturb the registry snapshot.
    function setActive(bool active) external {
        uint256 positionId = agentPosition[msg.sender];
        if (!registeredAgent[msg.sender]) revert Unauthorized();
        if (active && positionId != 0) {
            (address owner, uint256 amount, , , uint256 withdrawalRequestedAt) = stakeManager.positions(positionId);
            if (owner != msg.sender || amount < stakeManager.MINIMUM_STAKE() || withdrawalRequestedAt != 0) revert Unauthorized();
        } else if (active && agentCapabilities[msg.sender] != CAPABILITY_EXECUTE) {
            revert Unauthorized();
        }
        if (agentActive[msg.sender] == active) return;
        agentActive[msg.sender] = active;
        if (positionId != 0) {
            _advanceRegistry(keccak256(abi.encode("ACTIVE", msg.sender, positionId, active)));
            _writeStateCheckpoint(msg.sender);
        }
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
        if (
            capability == 0 || (agentCapabilities[agent] & capability) != capability ||
            !agentActive[agent] || !registeredAgent[agent]
        ) return false;
        if (capability != CAPABILITY_EXECUTE && !isEligible(agent)) return false;
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
        if (!registeredAgent[agent] || contextId == bytes32(0) || outcomeType == bytes32(0) || evidenceHash == bytes32(0) || (success && severe)) revert InvalidOutcome();
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
        if (!registeredAgent[agent] || evidenceHash == bytes32(0) || (!quality.banned && quality.cooldownUntil == 0)) revert InvalidOutcome();
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

    /// @notice Freezes the complete append-only candidate prefix before any
    /// selection entropy exists. A unique pool ID must bind the caller's task,
    /// work round/checkpoint and panel kind.
    function startSelectionPool(
        bytes32 poolId, uint256 taskId, uint8 capability, bool evaluatorPanel
    ) external {
        if (
            msg.sender != selectionRequester || poolId == bytes32(0) || taskId == 0 ||
            capability == 0 || selectionPools[poolId].requester != address(0)
        ) revert InvalidSelectionPool();
        _startSelectionPool(poolId, taskId, capability, evaluatorPanel, msg.sender);
    }

    function _startSelectionPool(
        bytes32 poolId, uint256 taskId, uint8 capability, bool evaluatorPanel, address requester
    ) private {
        if (
            poolId == bytes32(0) || taskId == 0 || capability == 0 || requester == address(0) ||
            selectionPools[poolId].requester != address(0)
        ) revert InvalidSelectionPool();
        uint256 count = registeredAgents.length;
        if (count < SELECTION_POOL_SIZE) revert InvalidSelectionPool();
        SelectionPool storage pool = selectionPools[poolId];
        pool.requester = requester;
        pool.taskId = taskId;
        pool.candidateCount = count;
        pool.snapshotVersion = registryVersion;
        pool.snapshotTime = uint64(block.timestamp);
        pool.capability = capability;
        pool.evaluatorPanel = evaluatorPanel;
        pool.candidateSetHash = registryHash;
        // Fenwick trees are one-indexed. Index zero is a permanent sentinel.
        selectionPoolFenwick[poolId].push(0);
        emit SelectionPoolStarted(
            poolId, taskId, requester, count, pool.snapshotVersion,
            pool.snapshotTime, capability, evaluatorPanel, pool.candidateSetHash
        );
    }

    /// @notice Adds the next bounded, sequential candidate page. No caller can
    /// skip a prefix or stop the pool early. Root entropy is scheduled only
    /// after completion; a recovered pool inherits observed predecessor entropy
    /// but still must build the entire deterministic prefix. Every frozen
    /// eligible candidate keeps its exact weight.
    function buildSelectionPool(bytes32 poolId, uint16 maxCandidates) external {
        SelectionPool storage pool = selectionPools[poolId];
        if (
            pool.requester == address(0) || pool.complete || maxCandidates == 0 ||
            maxCandidates > MAX_SELECTION_BUILD_PAGE || pool.cursor >= pool.candidateCount
        ) revert InvalidSelectionPool();
        uint256 end = pool.cursor + maxCandidates;
        if (end > pool.candidateCount) end = pool.candidateCount;
        for (uint256 i = pool.cursor; i < end; ++i) {
            address candidate = registeredAgents[i];
            uint256 weight = frozenSelectionWeightAt(
                candidate, pool.capability, pool.snapshotVersion, pool.snapshotTime
            );
            if (weight != 0) _appendSelectionWeight(poolId, candidate, weight);
        }
        pool.cursor = end;
        emit SelectionPoolProgress(poolId, end, pool.candidateCount, pool.totalWeight);
        if (end == pool.candidateCount) {
            pool.complete = true;
            if (pool.drawProof == bytes32(0)) pool.selectionBlock = block.number + SELECTION_ENTROPY_DELAY;
            emit SelectionPoolSealed(
                poolId, pool.taskId, pool.selectionBlock,
                selectionPoolCandidates[poolId].length, pool.totalWeight, pool.evaluatorPanel
            );
        }
    }

    /// @notice Reschedules entropy only after the old blockhash is objectively
    /// unavailable and before any candidate was drawn. The completed candidate
    /// pool is reused unchanged.
    function rescheduleSelectionPool(bytes32 poolId) external {
        SelectionPool storage pool = selectionPools[poolId];
        if (
            !pool.complete || pool.selectedCount != 0 || pool.drawProof != bytes32(0) || pool.selectionBlock == 0 ||
            block.number <= pool.selectionBlock + 256
        ) revert InvalidSelectionPool();
        pool.selectionBlock = block.number + SELECTION_ENTROPY_DELAY;
        pool.drawNonce = 0;
        pool.entropySeed = bytes32(0);
        pool.drawProof = bytes32(0);
        emit SelectionPoolSealed(
            poolId, pool.taskId, pool.selectionBlock,
            selectionPoolCandidates[poolId].length, pool.totalWeight, pool.evaluatorPanel
        );
    }

    /// @notice Draws toward a complete panel in O(log n) per member while
    /// pruning at most maxPrunes unsafe/conflicted candidates in this transaction.
    /// Partial progress persists across permissionless TaskRegistry retries.
    function drawSelectionPanel(bytes32 poolId, uint8 maxPrunes) external returns (
        address[3] memory winners, bool finalized, uint256 selectionBlock,
        bytes32 drawProof, bytes32 successorPoolId
    ) {
        SelectionPool storage pool = selectionPools[poolId];
        if (
            msg.sender != pool.requester || !pool.complete ||
            maxPrunes == 0 || maxPrunes > MAX_SELECTION_PRUNES || block.number <= pool.selectionBlock ||
            (pool.drawProof == bytes32(0) && block.number > pool.selectionBlock + 256)
        ) revert InvalidSelectionPool();
        if (pool.drawProof == bytes32(0)) {
            pool.entropySeed = blockhash(pool.selectionBlock);
            pool.drawProof = keccak256(abi.encode(
                pool.entropySeed, poolId, pool.taskId, pool.candidateSetHash,
                pool.candidateCount, pool.snapshotVersion, pool.snapshotTime,
                pool.capability, pool.evaluatorPanel
            ));
        }
        uint8 pruned;
        while (pool.selectedCount < SELECTION_POOL_SIZE && pool.totalWeight != 0) {
            uint256 ticket = uint256(keccak256(abi.encode(
                pool.entropySeed, pool.selectedCount, pool.drawNonce, "PAGINATED_WEIGHTED_SELECTION"
            ))) % pool.totalWeight;
            uint256 index = _selectionIndexForTicket(selectionPoolFenwick[poolId], ticket);
            address candidate = selectionPoolCandidates[poolId][index];
            uint256 weight = selectionPoolRemainingWeights[poolId][index];
            bool conflict = IAgentSelectionConflicts(msg.sender).isAgentSelectionConflict(
                pool.taskId, candidate, pool.evaluatorPanel
            );
            if (
                !conflict && selectionWeightAt(
                    candidate, pool.capability, pool.snapshotVersion, pool.snapshotTime
                ) != 0
            ) {
                _removeSelectionWeight(poolId, index, weight);
                uint8 slot = pool.selectedCount;
                selectionPoolWinners[poolId][slot] = candidate;
                pool.selectedCount = slot + 1;
                emit SelectionPoolCandidateSelected(poolId, pool.taskId, candidate, slot, pool.drawProof);
                continue;
            }
            _removeSelectionWeight(poolId, index, weight);
            pool.drawNonce += 1;
            emit SelectionPoolCandidatePruned(poolId, candidate, pool.drawNonce);
            pruned += 1;
            if (pruned == maxPrunes) break;
        }
        winners = selectionPoolWinners[poolId];
        finalized = pool.selectedCount == SELECTION_POOL_SIZE;
        selectionBlock = pool.selectionBlock;
        drawProof = pool.drawProof;
        if (!finalized && pool.totalWeight == 0) {
            if (pool.exhaustedVersion == 0) {
                pool.exhaustedVersion = registryVersion;
                emit SelectionPoolExhausted(poolId, pool.taskId, registryVersion, pool.selectedCount);
            } else if (pool.successorPoolId == bytes32(0) && registryVersion > pool.exhaustedVersion) {
                successorPoolId = keccak256(abi.encode(poolId, "EXHAUSTED_SELECTION_SUCCESSOR"));
                pool.successorPoolId = successorPoolId;
                _startSelectionPool(
                    successorPoolId, pool.taskId, pool.capability, pool.evaluatorPanel, pool.requester
                );
                SelectionPool storage successor = selectionPools[successorPoolId];
                successor.selectionBlock = pool.selectionBlock;
                successor.entropySeed = keccak256(abi.encode(
                    pool.entropySeed, successorPoolId, "EXHAUSTED_SELECTION_RECOVERY_ENTROPY"
                ));
                successor.drawProof = keccak256(abi.encode(
                    successor.entropySeed, successorPoolId, successor.taskId, successor.candidateSetHash,
                    successor.candidateCount, successor.snapshotVersion, successor.snapshotTime,
                    successor.capability, successor.evaluatorPanel
                ));
                emit SelectionPoolRecovered(
                    poolId, successorPoolId, pool.taskId, pool.exhaustedVersion, registryVersion
                );
            } else {
                successorPoolId = pool.successorPoolId;
            }
        }
    }

    function selectionPoolCandidate(bytes32 poolId, uint256 index) external view returns (address candidate, uint256 frozenWeight) {
        candidate = selectionPoolCandidates[poolId][index];
        frozenWeight = selectionPoolWeights[poolId][index];
    }

    function selectionPoolWinner(bytes32 poolId, uint8 slot) external view returns (address) {
        if (slot >= SELECTION_POOL_SIZE) revert InvalidSelectionPool();
        return selectionPoolWinners[poolId][slot];
    }

    function selectionPoolStatus(bytes32 poolId) external view returns (
        uint256 selectionBlock, uint256 remainingWeight, uint8 selectedCount,
        bool complete, bytes32 drawProof, uint64 exhaustedVersion,
        bytes32 successorPoolId, bytes32 entropySeed
    ) {
        SelectionPool storage pool = selectionPools[poolId];
        return (
            pool.selectionBlock, pool.totalWeight, pool.selectedCount, pool.complete,
            pool.drawProof, pool.exhaustedVersion, pool.successorPoolId, pool.entropySeed
        );
    }

    function canRecoverSelectionPool(bytes32 poolId) external view returns (bool) {
        SelectionPool storage pool = selectionPools[poolId];
        return (
            pool.complete && pool.totalWeight == 0 && pool.selectedCount < SELECTION_POOL_SIZE &&
            pool.exhaustedVersion != 0 && pool.successorPoolId == bytes32(0) &&
            registryVersion > pool.exhaustedVersion
        );
    }

    function _appendSelectionWeight(bytes32 poolId, address candidate, uint256 weight) private {
        address[] storage candidates = selectionPoolCandidates[poolId];
        uint256[] storage weights = selectionPoolWeights[poolId];
        uint256[] storage remainingWeights = selectionPoolRemainingWeights[poolId];
        uint256[] storage tree = selectionPoolFenwick[poolId];
        candidates.push(candidate);
        weights.push(weight);
        remainingWeights.push(weight);
        uint256 index = candidates.length;
        uint256 lowbit = index & (~index + 1);
        uint256 node = weight + _selectionPrefix(tree, index - 1) - _selectionPrefix(tree, index - lowbit);
        tree.push(node);
        selectionPools[poolId].totalWeight += weight;
    }

    function _removeSelectionWeight(bytes32 poolId, uint256 zeroBasedIndex, uint256 weight) private {
        if (weight == 0) revert InvalidSelectionPool();
        selectionPoolRemainingWeights[poolId][zeroBasedIndex] = 0;
        uint256[] storage tree = selectionPoolFenwick[poolId];
        uint256 index = zeroBasedIndex + 1;
        while (index < tree.length) {
            tree[index] -= weight;
            index += index & (~index + 1);
        }
        selectionPools[poolId].totalWeight -= weight;
    }

    function _selectionPrefix(uint256[] storage tree, uint256 index) private view returns (uint256 sum) {
        while (index != 0) {
            sum += tree[index];
            index -= index & (~index + 1);
        }
    }

    function _selectionIndexForTicket(uint256[] storage tree, uint256 ticket) private view returns (uint256) {
        uint256 count = tree.length - 1;
        uint256 bit = 1;
        while ((bit << 1) <= count) bit <<= 1;
        uint256 index;
        while (bit != 0) {
            uint256 next = index + bit;
            if (next <= count && tree[next] <= ticket) {
                index = next;
                ticket -= tree[next];
            }
            bit >>= 1;
        }
        if (index >= count) revert InvalidSelectionPool();
        return index;
    }

    function _advanceRegistry(bytes32 mutationHash) private {
        registryVersion += 1;
        registryHash = keccak256(abi.encode(registryHash, registryVersion, mutationHash));
        emit RegistrySnapshotAdvanced(registryVersion, registryHash);
    }

    function _writeStateCheckpoint(address agent) internal {
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
