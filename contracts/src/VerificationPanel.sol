// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVerificationPanelConsumer {
    function finalizeVerificationPanel(
        uint256 taskId, uint32 workRound, uint8 checkpoint, bool passed,
        address winner, bytes32 selectedArtifactHash, bytes32 aggregateEvidenceHash,
        uint16[] calldata executorWeightsBps, address[3] calldata testers, uint16[3] calldata testerRewardWeightsBps
    ) external;
    function getTaskExecutors(uint256 taskId) external view returns (address[] memory);
    function getTaskEvaluators(uint256 taskId) external view returns (address[3] memory);
    function tasks(uint256 taskId) external view returns (
        address, address, address, uint256, uint256, uint256, bytes32, bytes32, bytes32, bytes32,
        bytes32, uint256, uint256, bytes32, uint8, uint8, uint8, uint32, bool, uint8
    );
    function evaluationSelections(uint256 taskId) external view returns (
        uint256, uint256, uint256, bytes32, bytes32, uint8, uint8, bool
    );
    function evaluationReports(uint256 taskId, address evaluator) external view returns (
        bytes32, uint16, uint32, uint16, uint256, bool, bytes32, bool
    );
    function evaluationResults(uint256 taskId) external view returns (bytes32, uint16, uint32, uint16, uint256);
}

interface IQualityAgentRegistry {
    function recordTaskOutcome(
        address agent, uint8 role, uint256 taskId, address publisher, uint256 taskReward,
        bytes32 contextId, bytes32 outcomeType, bool success, bool severe, bytes32 evidenceHash
    ) external;
    function qualityMultiplierBps(address agent, uint8 role) external view returns (uint16);
}

interface IVerificationRewardVault {
    function setTesterPanel(uint256 taskId, uint8 checkpoint, address[3] calldata testers, uint16[3] calldata weightsBps) external;
}

/// @notice Three-validator commit/reveal panel. Criterion scopes are frozen at
/// panel creation and every required criterion must appear in exactly two
/// shards. Reports stay concealed until all three commitments exist.
contract VerificationPanel {
    uint16 private constant BPS = 10_000;
    uint8 private constant PANEL_SIZE = 3;
    uint256 public constant COMMIT_WINDOW = 1 days;
    uint256 public constant REVEAL_WINDOW = 1 days;
    uint256 public constant CHALLENGE_WINDOW = 1 days;
    bytes32 private constant REASON_UPHELD_CHALLENGE = keccak256("UPHELD_CHALLENGE");
    bytes32 private constant REASON_COMMIT_TIMEOUT = keccak256("COMMIT_TIMEOUT");
    bytes32 private constant REASON_REVEAL_TIMEOUT = keccak256("REVEAL_TIMEOUT");
    bytes32 private constant OUTCOME_VERIFICATION_COMPLETED = keccak256("VERIFICATION_COMPLETED");
    bytes32 private constant OUTCOME_EXECUTION_VERIFIED = keccak256("EXECUTION_VERIFIED");
    bytes32 private constant OUTCOME_EXECUTION_FAILED = keccak256("EXECUTION_FAILED");
    bytes32 private constant OUTCOME_EVALUATION_ALIGNED = keccak256("EVALUATION_ALIGNED");
    bytes32 private constant OUTCOME_EVALUATION_REJECTION_ALIGNED = keccak256("EVALUATION_REJECTION_ALIGNED");
    bytes32 private constant OUTCOME_EVALUATION_MISSED = keccak256("EVALUATION_MISSED");
    uint16[3] private ORDER_WEIGHTS = [uint16(4_000), uint16(3_333), uint16(2_667)];

    enum Status { None, Commit, Reveal, Challenge, Challenged, Finalized, Voided }
    struct Panel {
        address[3] testers;
        bytes32[3] scopeHashes;
        uint16[3] criterionMasks;
        uint16[3] qualityMultipliersBps;
        uint16 requiredCriterionMask;
        uint32 epoch;
        uint32 workRound;
        uint8 checkpoint;
        uint8 executorCount;
        uint8 commitCount;
        uint8 revealCount;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 challengeDeadline;
        Status status;
    }
    struct Report {
        bytes32 commitment;
        bytes32 evidenceHash;
        address winner;
        bytes32 selectedArtifactHash;
        uint16 criterionPassMask;
        uint8 commitOrder;
        bool revealed;
        uint16[] executorWeightsBps;
    }

    IVerificationPanelConsumer public immutable registry;
    IVerificationRewardVault public immutable rewardVault;
    IQualityAgentRegistry public immutable qualityRegistry;
    address public immutable bootstrapAdmin;
    address public arbitrationCourt;
    mapping(uint256 => Panel) private panels;
    mapping(uint256 => mapping(uint32 => mapping(address => Report))) private reports;
    mapping(uint256 => mapping(uint32 => uint16[])) private executorQualityMultipliersBps;
    mapping(uint256 => address) private challengedTester;
    mapping(uint256 => bytes32) private challengedHash;
    mapping(uint256 => bool) public evaluationOutcomesSettled;

    error Unauthorized();
    error InvalidPanel();
    error InvalidState();
    event PanelStarted(uint256 indexed taskId, uint32 indexed workRound, uint8 checkpoint, address[3] testers, uint16[3] criterionMasks, bytes32[3] scopeHashes);
    event ShardCommitted(uint256 indexed taskId, address indexed tester, uint8 indexed shard, uint32 epoch, uint32 workRound, uint8 commitOrder, bytes32 commitment);
    event PanelRevealReady(uint256 indexed taskId, uint32 indexed workRound, uint8 checkpoint, uint32 indexed epoch, address[3] testers);
    event ShardRevealed(uint256 indexed taskId, address indexed tester, uint8 indexed shard, uint32 epoch, uint32 workRound, bytes32 evidenceHash, uint16 criterionPassMask);
    event PanelAggregated(uint256 indexed taskId, bool passed, bytes32 aggregateEvidenceHash);
    event ValidatorRewardWeightsFrozen(
        uint256 indexed taskId, uint32 indexed workRound, uint8 checkpoint, uint32 indexed epoch,
        uint16[3] qualityMultipliersBps, uint8[3] commitOrders, uint16[3] finalWeightsBps, uint8 algorithmVersion
    );
    event PanelChallenged(uint256 indexed taskId, address indexed tester, bytes32 challengeHash);
    event PanelChallengeResolved(uint256 indexed taskId, bool upheld);
    event EvaluationOutcomesSettled(uint256 indexed taskId, bool approved, uint8 positiveCount, uint8 missedCount);
    event ExecutorQualityMultipliersFrozen(uint256 indexed taskId, uint32 indexed workRound, uint32 indexed epoch, uint16[] multipliersBps);

    constructor(IVerificationPanelConsumer registry_, IVerificationRewardVault rewardVault_, IQualityAgentRegistry qualityRegistry_, address bootstrapAdmin_) {
        if (address(registry_) == address(0) || address(rewardVault_) == address(0) || address(qualityRegistry_) == address(0) || bootstrapAdmin_ == address(0)) revert InvalidPanel();
        registry = registry_;
        rewardVault = rewardVault_;
        qualityRegistry = qualityRegistry_;
        bootstrapAdmin = bootstrapAdmin_;
    }

    function setArbitrationCourt(address court) external {
        if (msg.sender != bootstrapAdmin || court == address(0) || arbitrationCourt != address(0)) revert Unauthorized();
        arbitrationCourt = court;
    }

    function startPanel(
        uint256 taskId, uint32 workRound, uint8 checkpoint, uint8 executorCount,
        address[3] calldata testers, uint16 requiredCriterionMask,
        uint16[3] calldata criterionMasks, bytes32[3] calldata scopeHashes
    ) external {
        if (msg.sender != address(registry)) revert Unauthorized();
        Panel storage panel = panels[taskId];
        if (panel.status == Status.Commit || panel.status == Status.Reveal || panel.status == Status.Challenge || panel.status == Status.Challenged) revert InvalidState();
        if (executorCount == 0 || requiredCriterionMask == 0) revert InvalidPanel();
        for (uint8 i; i < PANEL_SIZE; ++i) {
            if (
                testers[i] == address(0) || scopeHashes[i] == bytes32(0) || criterionMasks[i] == 0 ||
                criterionMasks[i] == requiredCriterionMask || (criterionMasks[i] & ~requiredCriterionMask) != 0
            ) revert InvalidPanel();
            for (uint8 j; j < i; ++j) if (testers[i] == testers[j] || scopeHashes[i] == scopeHashes[j]) revert InvalidPanel();
        }
        for (uint8 bit; bit < 12; ++bit) if ((requiredCriterionMask & (uint16(1) << bit)) != 0) {
            uint8 coverage;
            for (uint8 i; i < PANEL_SIZE; ++i) if ((criterionMasks[i] & (uint16(1) << bit)) != 0) coverage += 1;
            if (coverage != 2) revert InvalidPanel();
        }
        uint32 epoch = panel.epoch + 1;
        uint16[3] memory qualityMultipliers = [
            qualityRegistry.qualityMultiplierBps(testers[0], 2),
            qualityRegistry.qualityMultiplierBps(testers[1], 2),
            qualityRegistry.qualityMultiplierBps(testers[2], 2)
        ];
        panels[taskId] = Panel({
            testers: testers, scopeHashes: scopeHashes, criterionMasks: criterionMasks, qualityMultipliersBps: qualityMultipliers,
            requiredCriterionMask: requiredCriterionMask, epoch: epoch, workRound: workRound,
            checkpoint: checkpoint, executorCount: executorCount, commitCount: 0, revealCount: 0,
            commitDeadline: uint64(block.timestamp + COMMIT_WINDOW), revealDeadline: 0,
            challengeDeadline: 0, status: Status.Commit
        });
        address[] memory executors = registry.getTaskExecutors(taskId);
        if (executors.length != executorCount) revert InvalidPanel();
        uint16[] storage frozenExecutorQuality = executorQualityMultipliersBps[taskId][epoch];
        for (uint256 i; i < executors.length; ++i) frozenExecutorQuality.push(qualityRegistry.qualityMultiplierBps(executors[i], 1));
        emit ExecutorQualityMultipliersFrozen(taskId, workRound, epoch, frozenExecutorQuality);
        emit PanelStarted(taskId, workRound, checkpoint, testers, criterionMasks, scopeHashes);
    }

    function commitShard(uint256 taskId, bytes32 commitment) external {
        Panel storage panel = panels[taskId];
        uint8 shard = _shard(panel, msg.sender);
        Report storage report = reports[taskId][panel.epoch][msg.sender];
        if (panel.status != Status.Commit || block.timestamp > panel.commitDeadline || commitment == bytes32(0) || report.commitment != bytes32(0)) revert InvalidState();
        report.commitment = commitment;
        report.commitOrder = panel.commitCount++;
        emit ShardCommitted(taskId, msg.sender, shard, panel.epoch, panel.workRound, report.commitOrder, commitment);
        if (panel.commitCount == PANEL_SIZE) {
            panel.status = Status.Reveal;
            panel.revealDeadline = uint64(block.timestamp + REVEAL_WINDOW);
            emit PanelRevealReady(taskId, panel.workRound, panel.checkpoint, panel.epoch, panel.testers);
        }
    }

    function revealShard(
        uint256 taskId, uint16 criterionPassMask, address winner, bytes32 selectedArtifactHash,
        bytes32 evidenceHash, uint16[] calldata executorWeightsBps, bytes32 salt
    ) external {
        Panel storage panel = panels[taskId];
        uint8 shard = _shard(panel, msg.sender);
        Report storage report = reports[taskId][panel.epoch][msg.sender];
        bytes32 expected = keccak256(abi.encode(taskId, panel.workRound, panel.checkpoint, shard, criterionPassMask, winner, selectedArtifactHash, evidenceHash, executorWeightsBps, salt));
        if (panel.status != Status.Reveal || block.timestamp > panel.revealDeadline || report.revealed || report.commitment != expected || evidenceHash == bytes32(0)) revert InvalidState();
        if ((criterionPassMask & ~panel.criterionMasks[shard]) != 0) revert InvalidPanel();
        uint256 total;
        if (criterionPassMask == panel.criterionMasks[shard]) {
            if (executorWeightsBps.length != panel.executorCount) revert InvalidPanel();
            for (uint256 i; i < executorWeightsBps.length; ++i) total += executorWeightsBps[i];
            if (total != BPS) revert InvalidPanel();
        } else if (executorWeightsBps.length != 0 || winner != address(0) || selectedArtifactHash != bytes32(0)) revert InvalidPanel();
        report.criterionPassMask = criterionPassMask;
        report.winner = winner;
        report.selectedArtifactHash = selectedArtifactHash;
        report.evidenceHash = evidenceHash;
        report.executorWeightsBps = executorWeightsBps;
        report.revealed = true;
        panel.revealCount += 1;
        emit ShardRevealed(taskId, msg.sender, shard, panel.epoch, panel.workRound, evidenceHash, criterionPassMask);
        if (panel.revealCount == PANEL_SIZE) { panel.status = Status.Challenge; panel.challengeDeadline = uint64(block.timestamp + CHALLENGE_WINDOW); }
    }

    function challenge(uint256 taskId, address tester, bytes32 challengeHash) external {
        if (msg.sender != arbitrationCourt) revert Unauthorized();
        Panel storage panel = panels[taskId];
        _shard(panel, tester);
        if (panel.status != Status.Challenge || block.timestamp > panel.challengeDeadline || challengeHash == bytes32(0)) revert InvalidState();
        panel.status = Status.Challenged;
        challengedTester[taskId] = tester;
        challengedHash[taskId] = challengeHash;
        emit PanelChallenged(taskId, tester, challengeHash);
    }

    function resolveChallenge(uint256 taskId, bool upheld, bytes32 caseId, bytes32 resolutionHash) external {
        if (msg.sender != arbitrationCourt) revert Unauthorized();
        Panel storage panel = panels[taskId];
        if (panel.status != Status.Challenged) revert InvalidState();
        address target = challengedTester[taskId];
        if (upheld) {
            if (caseId == bytes32(0) || resolutionHash == bytes32(0)) revert InvalidState();
            bytes32 severeEvidence = keccak256(abi.encode(
                caseId, resolutionHash, target,
                reports[taskId][panel.epoch][target].evidenceHash,
                challengedHash[taskId]
            ));
            _voidPanel(taskId, panel, REASON_UPHELD_CHALLENGE, target, severeEvidence);
        }
        else {
            panel.status = Status.Challenge;
            panel.challengeDeadline = uint64(block.timestamp);
        }
        delete challengedTester[taskId];
        delete challengedHash[taskId];
        emit PanelChallengeResolved(taskId, upheld);
    }

    /// @notice A missing commit or reveal cannot freeze a task forever.  Once
    /// the frozen phase deadline expires, anyone may void the panel and return
    /// the task to a new correction/work round.
    function expire(uint256 taskId) external {
        Panel storage panel = panels[taskId];
        bool commitExpired = panel.status == Status.Commit && block.timestamp > panel.commitDeadline;
        bool revealExpired = panel.status == Status.Reveal && block.timestamp > panel.revealDeadline;
        if (!commitExpired && !revealExpired) revert InvalidState();
        _voidPanel(taskId, panel, commitExpired ? REASON_COMMIT_TIMEOUT : REASON_REVEAL_TIMEOUT, address(0), bytes32(0));
    }

    function finalize(uint256 taskId) external {
        Panel storage panel = panels[taskId];
        if (panel.status != Status.Challenge || block.timestamp <= panel.challengeDeadline) revert InvalidState();
        uint16 passMask = _aggregatePassMask(taskId, panel);
        bool passed = passMask == panel.requiredCriterionMask;
        (address winner, bytes32 artifact, bool artifactConsensus) = _aggregateArtifact(taskId, panel);
        if (!artifactConsensus) passed = false;
        uint16[3] memory rewardWeights = _validatorRewardWeights(taskId, panel);
        bytes32[3] memory evidence;
        for (uint8 i; i < PANEL_SIZE; ++i) {
            evidence[i] = reports[taskId][panel.epoch][panel.testers[i]].evidenceHash;
        }
        uint16[] memory weights = _aggregateExecutorWeights(taskId, panel, rewardWeights, passed);
        bytes32 aggregateEvidenceHash = keccak256(abi.encode(taskId, panel.workRound, panel.checkpoint, evidence, panel.testers, passMask));
        _recordCompletedOutcomes(taskId, panel, evidence);
        _recordExecutorOutcomes(taskId, panel, passed, winner, aggregateEvidenceHash);
        panel.status = Status.Finalized;
        registry.finalizeVerificationPanel(taskId, panel.workRound, panel.checkpoint, passed, winner, artifact, aggregateEvidenceHash, weights, panel.testers, rewardWeights);
        if (passed) rewardVault.setTesterPanel(taskId, panel.checkpoint, panel.testers, rewardWeights);
        _emitRewardWeights(taskId, panel, rewardWeights);
        emit PanelAggregated(taskId, passed, aggregateEvidenceHash);
    }

    /// @notice Permissionless, one-shot quality settlement after the canonical
    /// evaluation reaches a terminal result. Minority/dissenting reports remain
    /// neutral; only objective alignment earns a gain and only missing reports
    /// are penalized.
    function settleEvaluationOutcomes(uint256 taskId) external {
        if (evaluationOutcomesSettled[taskId]) revert InvalidState();
        (,,,,,,,,,,,,,,,,,,, uint8 state) = registry.tasks(taskId);
        (,,,,, uint8 reportCount, uint8 approveCount, bool panelFinalized) = registry.evaluationSelections(taskId);
        if (!panelFinalized || state == 0 || state == 1) revert InvalidState();
        (bytes32 finalCategory,,,,) = registry.evaluationResults(taskId);
        bool approved = finalCategory != bytes32(0);
        if (approved && state == 10) revert InvalidState();
        evaluationOutcomesSettled[taskId] = true;
        address[3] memory evaluators = registry.getTaskEvaluators(taskId);
        uint8 positiveCount;
        uint8 missedCount;
        bytes32 contextId = keccak256(abi.encode(taskId, "EVALUATION_OUTCOME"));
        for (uint8 i; i < 3; ++i) {
            (bytes32 category,,,,, bool voteApprove, bytes32 reportHash, bool submitted) = registry.evaluationReports(taskId, evaluators[i]);
            if (!submitted) {
                missedCount += 1;
                _recordTaskOutcome(taskId,
                    evaluators[i], 4, contextId, OUTCOME_EVALUATION_MISSED, false, false,
                    keccak256(abi.encode(taskId, evaluators[i], reportCount, "MISSING_EVALUATION_REPORT"))
                );
            } else if (approved && voteApprove && category == finalCategory) {
                positiveCount += 1;
                _recordTaskOutcome(taskId, evaluators[i], 4, contextId, OUTCOME_EVALUATION_ALIGNED, true, false, reportHash);
            } else if (!approved && approveCount < 2 && !voteApprove) {
                positiveCount += 1;
                _recordTaskOutcome(taskId, evaluators[i], 4, contextId, OUTCOME_EVALUATION_REJECTION_ALIGNED, true, false, reportHash);
            }
        }
        emit EvaluationOutcomesSettled(taskId, approved, positiveCount, missedCount);
    }

    function _emitRewardWeights(uint256 taskId, Panel storage panel, uint16[3] memory rewardWeights) private {
        uint8[3] memory commitOrders = [
            reports[taskId][panel.epoch][panel.testers[0]].commitOrder,
            reports[taskId][panel.epoch][panel.testers[1]].commitOrder,
            reports[taskId][panel.epoch][panel.testers[2]].commitOrder
        ];
        emit ValidatorRewardWeightsFrozen(taskId, panel.workRound, panel.checkpoint, panel.epoch, panel.qualityMultipliersBps, commitOrders, rewardWeights, 1);
    }

    function _aggregatePassMask(uint256 taskId, Panel storage panel) private view returns (uint16 passMask) {
        for (uint8 bit; bit < 12; ++bit) {
            uint8 votes;
            for (uint8 i; i < PANEL_SIZE; ++i) {
                if ((reports[taskId][panel.epoch][panel.testers[i]].criterionPassMask & (uint16(1) << bit)) != 0) votes += 1;
            }
            if (votes >= 2) passMask |= uint16(1) << bit;
        }
    }

    function _aggregateArtifact(uint256 taskId, Panel storage panel) private view returns (address winner, bytes32 artifact, bool consensus) {
        Report storage first = reports[taskId][panel.epoch][panel.testers[0]];
        Report storage second = reports[taskId][panel.epoch][panel.testers[1]];
        Report storage third = reports[taskId][panel.epoch][panel.testers[2]];
        if (first.winner == second.winner && first.selectedArtifactHash == second.selectedArtifactHash) {
            return (first.winner, first.selectedArtifactHash, true);
        }
        if (first.winner == third.winner && first.selectedArtifactHash == third.selectedArtifactHash) {
            return (first.winner, first.selectedArtifactHash, true);
        }
        if (second.winner == third.winner && second.selectedArtifactHash == third.selectedArtifactHash) {
            return (second.winner, second.selectedArtifactHash, true);
        }
    }

    function _aggregateExecutorWeights(
        uint256 taskId, Panel storage panel, uint16[3] memory rewardWeights, bool passed
    ) private view returns (uint16[] memory weights) {
        weights = new uint16[](panel.executorCount);
        if (!passed) return weights;
        uint256[] memory raw = new uint256[](panel.executorCount);
        uint16[] storage frozenQuality = executorQualityMultipliersBps[taskId][panel.epoch];
        if (frozenQuality.length != panel.executorCount) revert InvalidPanel();
        for (uint8 i; i < PANEL_SIZE; ++i) {
            Report storage report = reports[taskId][panel.epoch][panel.testers[i]];
            for (uint256 j; j < weights.length; ++j) raw[j] += uint256(report.executorWeightsBps[j]) * rewardWeights[i];
        }
        uint256 rawTotal;
        for (uint256 j; j < weights.length; ++j) {
            raw[j] *= frozenQuality[j];
            rawTotal += raw[j];
        }
        if (rawTotal == 0) revert InvalidPanel();
        uint256 sum;
        for (uint256 j; j < weights.length; ++j) { weights[j] = uint16((raw[j] * BPS) / rawTotal); sum += weights[j]; }
        weights[0] += uint16(BPS - sum);
    }

    function getPanel(uint256 taskId) external view returns (Panel memory) { return panels[taskId]; }

    function getReport(uint256 taskId, address tester) external view returns (Report memory) {
        Panel storage panel = panels[taskId];
        return reports[taskId][panel.epoch][tester];
    }

    function getExecutorQualityMultipliers(uint256 taskId) external view returns (uint16[] memory) {
        Panel storage panel = panels[taskId];
        return executorQualityMultipliersBps[taskId][panel.epoch];
    }

    function isPanelTester(uint256 taskId, address tester) external view returns (bool) {
        Panel storage panel = panels[taskId];
        for (uint8 i; i < PANEL_SIZE; ++i) if (panel.testers[i] == tester) return true;
        return false;
    }

    function _validatorRewardWeights(uint256 taskId, Panel storage panel) private view returns (uint16[3] memory weights) {
        uint256[3] memory raw;
        uint256 total;
        uint8 firstCommitter;
        for (uint8 i; i < PANEL_SIZE; ++i) {
            Report storage report = reports[taskId][panel.epoch][panel.testers[i]];
            raw[i] = uint256(ORDER_WEIGHTS[report.commitOrder]) * panel.qualityMultipliersBps[i];
            total += raw[i];
            if (report.commitOrder == 0) firstCommitter = i;
        }
        uint256 assigned;
        for (uint8 i; i < PANEL_SIZE; ++i) {
            weights[i] = uint16((raw[i] * BPS) / total);
            assigned += weights[i];
        }
        weights[firstCommitter] += uint16(BPS - assigned);
    }

    function _voidPanel(uint256 taskId, Panel storage panel, bytes32 reason, address severeFault, bytes32 severeEvidence) private {
        address[3] memory testers = panel.testers;
        uint16[3] memory rewardWeights = [uint16(4_000), uint16(3_333), uint16(2_667)];
        uint16[] memory noExecutorWeights = new uint16[](0);
        bytes32 evidenceHash = keccak256(abi.encode(taskId, panel.workRound, panel.checkpoint, panel.epoch, reason));
        bytes32 contextId = _qualityContext(taskId, panel);
        for (uint8 i; i < PANEL_SIZE; ++i) {
            Report storage report = reports[taskId][panel.epoch][testers[i]];
            if (testers[i] == severeFault) {
                _recordTaskOutcome(taskId, testers[i], 2, contextId, reason, false, true, severeEvidence);
            } else if (reason == REASON_COMMIT_TIMEOUT && report.commitment == bytes32(0)) {
                _recordTaskOutcome(taskId, testers[i], 2, contextId, reason, false, false, evidenceHash);
            } else if (reason == REASON_REVEAL_TIMEOUT) {
                _recordTaskOutcome(taskId, testers[i], 2, contextId, reason, report.revealed, false, report.revealed ? report.evidenceHash : evidenceHash);
            } else if (reason == REASON_UPHELD_CHALLENGE) {
                _recordTaskOutcome(taskId, testers[i], 2, contextId, OUTCOME_VERIFICATION_COMPLETED, true, false, report.evidenceHash);
            }
        }
        panel.status = Status.Voided;
        registry.finalizeVerificationPanel(
            taskId, panel.workRound, panel.checkpoint, false, address(0), bytes32(0),
            evidenceHash, noExecutorWeights, testers, rewardWeights
        );
    }

    function _qualityContext(uint256 taskId, Panel storage panel) private view returns (bytes32) {
        return keccak256(abi.encode(taskId, panel.workRound, panel.checkpoint, panel.epoch));
    }

    function _recordTaskOutcome(
        uint256 taskId, address agent, uint8 role, bytes32 contextId,
        bytes32 outcomeType, bool success, bool severe, bytes32 evidenceHash
    ) private {
        (bool ok, bytes memory taskData) = address(registry).staticcall(
            abi.encodeWithSelector(IVerificationPanelConsumer.tasks.selector, taskId)
        );
        if (!ok || taskData.length != 640) revert InvalidState();
        uint256 publisherWord;
        uint256 taskReward;
        assembly ("memory-safe") {
            publisherWord := mload(add(taskData, 32))
            taskReward := mload(add(taskData, 160))
        }
        address publisher = address(uint160(publisherWord));
        qualityRegistry.recordTaskOutcome(
            agent, role, taskId, publisher, taskReward,
            contextId, outcomeType, success, severe, evidenceHash
        );
    }

    function _recordCompletedOutcomes(uint256 taskId, Panel storage panel, bytes32[3] memory evidence) private {
        bytes32 contextId = _qualityContext(taskId, panel);
        for (uint8 i; i < PANEL_SIZE; ++i) {
            _recordTaskOutcome(taskId, panel.testers[i], 2, contextId, OUTCOME_VERIFICATION_COMPLETED, true, false, evidence[i]);
        }
    }

    function _recordExecutorOutcomes(
        uint256 taskId, Panel storage panel, bool passed, address winner, bytes32 evidenceHash
    ) private {
        address[] memory executors = registry.getTaskExecutors(taskId);
        bytes32 contextId = keccak256(abi.encode(_qualityContext(taskId, panel), "EXECUTOR_OUTCOME"));
        for (uint256 i; i < executors.length; ++i) {
            // Competition losers remain neutral: losing a valid comparison is
            // not equivalent to submitting work that failed verification.
            if (passed && winner != address(0) && executors[i] != winner) continue;
            _recordTaskOutcome(taskId,
                executors[i], 1, contextId,
                passed ? OUTCOME_EXECUTION_VERIFIED : OUTCOME_EXECUTION_FAILED,
                passed, false, evidenceHash
            );
        }
    }

    function _shard(Panel storage panel, address tester) private view returns (uint8) {
        for (uint8 i; i < PANEL_SIZE; ++i) if (panel.testers[i] == tester) return i;
        revert Unauthorized();
    }
}
