// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVerificationPanelConsumer {
    function finalizeVerificationPanel(
        uint256 taskId, uint32 workRound, uint8 checkpoint, bool passed,
        address winner, bytes32 selectedArtifactHash, bytes32 aggregateEvidenceHash,
        uint16[] calldata executorWeightsBps, address[3] calldata testers, uint16[3] calldata testerRewardWeightsBps
    ) external;
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
    uint16[3] private ORDER_WEIGHTS = [uint16(4_000), uint16(3_333), uint16(2_667)];

    enum Status { None, Commit, Reveal, Challenge, Challenged, Finalized, Voided }
    struct Panel {
        address[3] testers;
        bytes32[3] scopeHashes;
        uint16[3] criterionMasks;
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
    address public immutable bootstrapAdmin;
    address public arbitrationCourt;
    mapping(uint256 => Panel) private panels;
    mapping(uint256 => mapping(uint32 => mapping(address => Report))) private reports;

    error Unauthorized();
    error InvalidPanel();
    error InvalidState();
    event PanelStarted(uint256 indexed taskId, uint32 indexed workRound, uint8 checkpoint, address[3] testers, uint16[3] criterionMasks, bytes32[3] scopeHashes);
    event ShardCommitted(uint256 indexed taskId, address indexed tester, uint8 indexed shard, uint32 epoch, uint32 workRound, uint8 commitOrder, bytes32 commitment);
    event ShardRevealed(uint256 indexed taskId, address indexed tester, uint8 indexed shard, uint32 epoch, uint32 workRound, bytes32 evidenceHash, uint16 criterionPassMask);
    event PanelAggregated(uint256 indexed taskId, bool passed, bytes32 aggregateEvidenceHash);
    event PanelChallenged(uint256 indexed taskId, address indexed tester, bytes32 challengeHash);
    event PanelChallengeResolved(uint256 indexed taskId, bool upheld);

    constructor(IVerificationPanelConsumer registry_, IVerificationRewardVault rewardVault_, address bootstrapAdmin_) {
        if (address(registry_) == address(0) || address(rewardVault_) == address(0) || bootstrapAdmin_ == address(0)) revert InvalidPanel();
        registry = registry_;
        rewardVault = rewardVault_;
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
        panels[taskId] = Panel({
            testers: testers, scopeHashes: scopeHashes, criterionMasks: criterionMasks,
            requiredCriterionMask: requiredCriterionMask, epoch: epoch, workRound: workRound,
            checkpoint: checkpoint, executorCount: executorCount, commitCount: 0, revealCount: 0,
            commitDeadline: uint64(block.timestamp + COMMIT_WINDOW), revealDeadline: 0,
            challengeDeadline: 0, status: Status.Commit
        });
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
        emit PanelChallenged(taskId, tester, challengeHash);
    }

    function resolveChallenge(uint256 taskId, bool upheld) external {
        if (msg.sender != arbitrationCourt) revert Unauthorized();
        Panel storage panel = panels[taskId];
        if (panel.status != Status.Challenged) revert InvalidState();
        if (upheld) _voidPanel(taskId, panel, REASON_UPHELD_CHALLENGE);
        else {
            panel.status = Status.Challenge;
            panel.challengeDeadline = uint64(block.timestamp);
        }
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
        _voidPanel(taskId, panel, commitExpired ? REASON_COMMIT_TIMEOUT : REASON_REVEAL_TIMEOUT);
    }

    function finalize(uint256 taskId) external {
        Panel storage panel = panels[taskId];
        if (panel.status != Status.Challenge || block.timestamp <= panel.challengeDeadline) revert InvalidState();
        uint16 passMask;
        bytes32[3] memory evidence;
        uint16[] memory weights = new uint16[](panel.executorCount);
        uint256[] memory rawWeights = new uint256[](panel.executorCount);
        for (uint8 bit; bit < 12; ++bit) {
            uint8 votes;
            for (uint8 i; i < PANEL_SIZE; ++i) if ((reports[taskId][panel.epoch][panel.testers[i]].criterionPassMask & (uint16(1) << bit)) != 0) votes += 1;
            if (votes >= 2) passMask |= uint16(1) << bit;
        }
        bool passed = passMask == panel.requiredCriterionMask;
        Report storage first = reports[taskId][panel.epoch][panel.testers[0]];
        Report storage second = reports[taskId][panel.epoch][panel.testers[1]];
        Report storage third = reports[taskId][panel.epoch][panel.testers[2]];
        address winner;
        bytes32 artifact;
        if (first.winner == second.winner && first.selectedArtifactHash == second.selectedArtifactHash) {
            winner = first.winner; artifact = first.selectedArtifactHash;
        } else if (first.winner == third.winner && first.selectedArtifactHash == third.selectedArtifactHash) {
            winner = first.winner; artifact = first.selectedArtifactHash;
        } else if (second.winner == third.winner && second.selectedArtifactHash == third.selectedArtifactHash) {
            winner = second.winner; artifact = second.selectedArtifactHash;
        } else passed = false;
        uint16[3] memory rewardWeights;
        for (uint8 i; i < PANEL_SIZE; ++i) {
            Report storage report = reports[taskId][panel.epoch][panel.testers[i]];
            evidence[i] = report.evidenceHash;
            rewardWeights[i] = ORDER_WEIGHTS[report.commitOrder];
            if (passed) for (uint256 j; j < weights.length; ++j) rawWeights[j] += uint256(report.executorWeightsBps[j]) * rewardWeights[i];
        }
        if (passed) {
            uint256 sum;
            for (uint256 j; j < weights.length; ++j) { weights[j] = uint16(rawWeights[j] / BPS); sum += weights[j]; }
            weights[0] += uint16(BPS - sum);
        }
        bytes32 aggregateEvidenceHash = keccak256(abi.encode(taskId, panel.workRound, panel.checkpoint, evidence, panel.testers, passMask));
        panel.status = Status.Finalized;
        registry.finalizeVerificationPanel(taskId, panel.workRound, panel.checkpoint, passed, winner, artifact, aggregateEvidenceHash, weights, panel.testers, rewardWeights);
        if (passed) rewardVault.setTesterPanel(taskId, panel.checkpoint, panel.testers, rewardWeights);
        emit PanelAggregated(taskId, passed, aggregateEvidenceHash);
    }

    function getPanel(uint256 taskId) external view returns (Panel memory) { return panels[taskId]; }

    function getReport(uint256 taskId, address tester) external view returns (Report memory) {
        Panel storage panel = panels[taskId];
        return reports[taskId][panel.epoch][tester];
    }

    function isPanelTester(uint256 taskId, address tester) external view returns (bool) {
        Panel storage panel = panels[taskId];
        for (uint8 i; i < PANEL_SIZE; ++i) if (panel.testers[i] == tester) return true;
        return false;
    }

    function _voidPanel(uint256 taskId, Panel storage panel, bytes32 reason) private {
        address[3] memory testers = panel.testers;
        uint16[3] memory rewardWeights = [uint16(4_000), uint16(3_333), uint16(2_667)];
        uint16[] memory noExecutorWeights = new uint16[](0);
        bytes32 evidenceHash = keccak256(abi.encode(taskId, panel.workRound, panel.checkpoint, panel.epoch, reason));
        panel.status = Status.Voided;
        registry.finalizeVerificationPanel(
            taskId, panel.workRound, panel.checkpoint, false, address(0), bytes32(0),
            evidenceHash, noExecutorWeights, testers, rewardWeights
        );
    }

    function _shard(Panel storage panel, address tester) private view returns (uint8) {
        for (uint8 i; i < PANEL_SIZE; ++i) if (panel.testers[i] == tester) return i;
        revert Unauthorized();
    }
}
