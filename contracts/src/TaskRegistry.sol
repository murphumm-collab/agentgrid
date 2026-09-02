// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {StakeCreditManager} from "./StakeCreditManager.sol";
import {RewardVault} from "./RewardVault.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {VerificationPanel} from "./VerificationPanel.sol";
import {ProtocolEconomics} from "./ProtocolEconomics.sol";

interface ICompetitionSlotPassRegistry {
    function taskRegistry() external view returns (address);
    function consumeFor(address publisher, bytes32 specHash, uint8 totalSlots)
        external returns (bytes32 authorizationId, bytes32 paymentReceiptHash);
}

contract TaskRegistry is Ownable {
    uint256 public constant ABUSIVE_REJECTION_SLASH_BPS = 500;
    uint256 public constant BPS = 10_000;
    uint256 public constant REJECTION_RESPONSE_WINDOW = 3 days;
    uint256 public constant TEAM_FORMATION_WINDOW = 1 days;
    uint256 public constant EXECUTOR_INACTIVITY_WINDOW = 6 hours;
    uint256 public constant EVALUATION_SELECTION_DELAY = 5;
    uint256 public constant EVALUATION_WINDOW = 3 days;
    uint8 private constant EVALUATOR_COUNT = 3;
    enum State { None, Evaluating, Open, Claimed, Submitted, Testing, Correction, UserReview, Maintenance, Completed, Rejected }
    enum ExecutionMode { Collaboration, Competition }

    struct Task {
        address publisher;
        address executor;
        address tester;
        uint256 positionId;
        uint256 requestedReward;
        uint256 createdAt;
        bytes32 specHash;
        bytes32 artifactHash;
        bytes32 evidenceHash;
        bytes32 candidateSetHash;
        bytes32 selectionProof;
        uint256 testerSelectionBlock;
        uint256 testerCandidateCount;
        bytes32 teamHash;
        uint8 maxExecutors;
        uint8 executorCount;
        uint8 contributionCount;
        uint32 workRound;
        bool teamClosed;
        State state;
    }

    StakeCreditManager public immutable stakeManager;
    RewardVault public immutable rewardVault;
    AgentRegistry public immutable agentRegistry;
    address public immutable coordinator;
    address public disputeResolver;
    VerificationPanel public verificationPanel;
    ProtocolEconomics public protocolEconomics;
    ICompetitionSlotPassRegistry private competitionSlotPassRegistry;
    uint256 public nextTaskId = 1;
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => ExecutionMode) private taskExecutionMode;
    mapping(uint256 => uint8) public taskRequiredTesterCapabilities;
    mapping(uint256 => address) private competitionWinner;
    mapping(uint256 => uint256) public taskPublicationFee;
    mapping(uint256 => uint256) private publisherStakeBasis;
    mapping(uint256 => address[]) private taskExecutors;
    mapping(uint256 => uint16[]) private taskExecutorWeightsBps;
    mapping(uint256 => mapping(address => bool)) public isTaskExecutor;
    mapping(uint256 => mapping(address => uint32)) public contributionRound;
    mapping(uint256 => mapping(address => bytes32)) public contributionHash;
    mapping(uint256 => mapping(address => uint256)) public executorClaimedAt;
    mapping(uint256 => uint256) public teamFormationStartedAt;
    mapping(uint256 => uint32) public teamReadyRound;
    mapping(uint256 => mapping(uint8 => bytes32)) private maintenanceEvidence;
    mapping(uint256 => uint8) private maintenanceRepairCheckpoint;
    mapping(uint256 => address[3]) private taskTesters;
    struct EvaluationSelection {
        uint256 selectionBlock;
        uint256 candidateCount;
        uint256 deadline;
        bytes32 candidateSetHash;
        bytes32 selectionProof;
        uint8 reportCount;
        uint8 approveCount;
        bool panelFinalized;
    }
    struct EvaluationReport {
        bytes32 categoryHash;
        uint16 difficultyBps;
        uint32 estimatedHours;
        uint16 testabilityBps;
        uint256 recommendedReward;
        bool approve;
        bytes32 reportHash;
        bool submitted;
    }
    struct EvaluationResult {
        bytes32 categoryHash;
        uint16 difficultyBps;
        uint32 estimatedHours;
        uint16 testabilityBps;
        uint256 recommendedReward;
    }
    mapping(uint256 => EvaluationSelection) public evaluationSelections;
    mapping(uint256 => address[3]) private taskEvaluators;
    mapping(uint256 => mapping(address => bool)) public isTaskEvaluator;
    mapping(uint256 => mapping(address => EvaluationReport)) public evaluationReports;
    mapping(uint256 => EvaluationResult) public evaluationResults;
    struct RejectionDispute { bytes32 reasonHash; bytes32 responseHash; uint256 openedAt; }
    mapping(uint256 => RejectionDispute) public rejectionDisputes;

    error Unauthorized();
    error InvalidState();
    error InvalidTesterSet();
    error TesterConflict();
    error InvalidExecutorWeights();
    error InvalidEvaluation();

    event TaskCreated(uint256 indexed taskId, address indexed publisher, uint256 indexed positionId, bytes32 specHash);
    event TaskExecutionModeSet(uint256 indexed taskId, ExecutionMode mode);
    event TaskTesterCapabilitiesSet(uint256 indexed taskId, uint8 requiredCapabilities);
    event ExecutorSlotsFrozen(
        uint256 indexed taskId,
        uint8 includedSlots,
        uint8 paidExtraSlots,
        uint8 totalSlots,
        bytes32 authorizationId,
        bytes32 paymentReceiptHash
    );
    event TaskEvaluationRequested(
        uint256 indexed taskId,
        address indexed publisher,
        uint256 indexed positionId,
        bytes32 specHash,
        uint256 selectionBlock,
        bytes32 candidateSetHash,
        uint256 candidateCount,
        uint256 deadline
    );
    event TaskEvaluatorsAssigned(uint256 indexed taskId, address indexed evaluator0, address indexed evaluator1, address evaluator2, bytes32 selectionProof);
    event TaskEvaluationSubmitted(uint256 indexed taskId, address indexed evaluator, bool approve, bytes32 indexed categoryHash, bytes32 reportHash);
    event TaskEvaluationFinalized(uint256 indexed taskId, bool approved, bytes32 categoryHash, uint16 difficultyBps, uint32 estimatedHours, uint16 testabilityBps, uint256 requestedReward);
    event TaskEvaluationExpired(uint256 indexed taskId);
    event TaskPublicationFeeCharged(uint256 indexed taskId, uint256 indexed positionId, uint256 amount, address indexed recipient);
    event TaskEvaluationFeeCharged(uint256 indexed taskId, uint256 indexed positionId, uint256 amount, address indexed recipient);
    event TaskClaimed(uint256 indexed taskId, address indexed executor);
    event ExecutorEvicted(uint256 indexed taskId, address indexed executor);
    event TeamClosed(uint256 indexed taskId, uint256 executorCount);
    event ContributionSubmitted(uint256 indexed taskId, address indexed executor, uint32 indexed workRound, bytes32 contributionHash);
    event TeamReady(uint256 indexed taskId, address indexed leadExecutor, uint32 indexed workRound);
    event CompetitionReady(uint256 indexed taskId, uint32 indexed workRound, uint256 candidateCount);
    event WorkSubmitted(uint256 indexed taskId, bytes32 artifactHash);
    event TesterRequested(uint256 indexed taskId, uint256 indexed selectionBlock, bytes32 candidateSetHash, uint256 candidateCount);
    event TesterAssigned(uint256 indexed taskId, address indexed tester, bytes32 selectionProof);
    event TesterPanelAssigned(uint256 indexed taskId, address indexed tester0, address indexed tester1, address tester2, bytes32 selectionProof, uint32 workRound);
    event TestSubmitted(uint256 indexed taskId, bool passed, bytes32 evidenceHash);
    event CompetitionResultSubmitted(uint256 indexed taskId, bool passed, address indexed winner, bytes32 artifactHash, bytes32 evidenceHash);
    event UserReviewed(uint256 indexed taskId, bool accepted, bytes32 reasonHash);
    event RejectionResponded(uint256 indexed taskId, address indexed executor, bytes32 responseHash);
    event MaintenanceValidated(uint256 indexed taskId, uint8 indexed checkpoint, bool passed, bytes32 evidenceHash);
    event MaintenanceRepairRequested(uint256 indexed taskId, uint8 indexed checkpoint, uint32 indexed workRound, bytes32 evidenceHash);
    event MaintenancePanelRequested(uint256 indexed taskId, uint8 indexed checkpoint, uint32 indexed workRound);
    event RejectionResolved(uint256 indexed taskId, bool executorWins, bytes32 resolutionHash, uint256 publisherSlash);

    constructor(
        StakeCreditManager stakeManager_,
        RewardVault rewardVault_,
        AgentRegistry agentRegistry_,
        address coordinator_,
        address initialOwner
    ) Ownable(initialOwner) {
        stakeManager = stakeManager_;
        rewardVault = rewardVault_;
        agentRegistry = agentRegistry_;
        coordinator = coordinator_;
        disputeResolver = coordinator_;
    }

    modifier onlyDisputeResolver() {
        if (msg.sender != disputeResolver) revert Unauthorized();
        _;
    }

    function setVerificationPanel(VerificationPanel panel) external onlyOwner {
        if (address(panel) == address(0) || address(verificationPanel) != address(0)) revert InvalidState();
        verificationPanel = panel;
    }

    function setProtocolEconomics(ProtocolEconomics economics) external onlyOwner {
        if (
            address(economics) == address(0) || address(protocolEconomics) != address(0) ||
            address(stakeManager.protocolEconomics()) != address(economics) ||
            address(rewardVault.protocolEconomics()) != address(economics)
        ) revert InvalidState();
        protocolEconomics = economics;
    }

    function setCompetitionSlotPassRegistry(ICompetitionSlotPassRegistry registry) external onlyOwner {
        if (
            address(competitionSlotPassRegistry) != address(0) || registry.taskRegistry() != address(this)
        ) revert InvalidState();
        competitionSlotPassRegistry = registry;
    }

    function setDisputeResolver(address newResolver) external onlyOwner {
        if (newResolver == address(0)) revert Unauthorized();
        disputeResolver = newResolver;
    }

    function createTaskWithMode(
        uint256 positionId,
        bytes32 specHash,
        uint256 requestedReward,
        uint8 maxExecutors,
        ExecutionMode mode
    ) external returns (uint256 taskId) {
        return _createTask(positionId, specHash, requestedReward, maxExecutors, mode, agentRegistry.CAPABILITY_TEST());
    }

    function createTaskWithModeAndTesterCapabilities(
        uint256 positionId,
        bytes32 specHash,
        uint256 requestedReward,
        uint8 maxExecutors,
        ExecutionMode mode,
        uint8 requiredTesterCapabilities
    ) external returns (uint256 taskId) {
        return _createTask(positionId, specHash, requestedReward, maxExecutors, mode, requiredTesterCapabilities);
    }

    function _createTask(
        uint256 positionId,
        bytes32 specHash,
        uint256 requestedReward,
        uint8 maxExecutors,
        ExecutionMode mode,
        uint8 requiredTesterCapabilities
    ) private returns (uint256 taskId) {
        if (address(protocolEconomics) == address(0)) revert InvalidState();
        if (stakeManager.ownerOf(positionId) != msg.sender) revert Unauthorized();
        if (specHash == bytes32(0) || requestedReward == 0 || maxExecutors == 0 || maxExecutors > 32) revert InvalidState();
        // A task may require one or more verification specialities, but it may
        // not accidentally require executor/evaluator roles from its tester.
        if ((requiredTesterCapabilities & agentRegistry.BASE_CAPABILITIES()) != agentRegistry.CAPABILITY_TEST()) revert InvalidTesterSet();
        uint8 includedSlots = maxExecutors;
        uint8 paidExtraSlots;
        bytes32 slotAuthorizationId;
        bytes32 paymentReceiptHash;
        if (mode == ExecutionMode.Competition && maxExecutors > 2) {
            includedSlots = 2;
            (slotAuthorizationId, paymentReceiptHash) =
                competitionSlotPassRegistry.consumeFor(msg.sender, specHash, maxExecutors);
            unchecked { paidExtraSlots = maxExecutors - 2; }
        }
        taskId = nextTaskId++;
        tasks[taskId] = Task({
            publisher: msg.sender,
            executor: address(0),
            tester: address(0),
            positionId: positionId,
            requestedReward: requestedReward,
            createdAt: block.timestamp,
            specHash: specHash,
            artifactHash: bytes32(0),
            evidenceHash: bytes32(0),
            candidateSetHash: bytes32(0),
            selectionProof: bytes32(0),
            testerSelectionBlock: 0,
            testerCandidateCount: 0,
            teamHash: bytes32(0),
            maxExecutors: maxExecutors,
            executorCount: 0,
            contributionCount: 0,
            workRound: 1,
            teamClosed: false,
            state: State.Evaluating
        });
        taskExecutionMode[taskId] = mode;
        taskRequiredTesterCapabilities[taskId] = requiredTesterCapabilities;
        assembly ("memory-safe") {
            let data := mload(0x40)
            mstore(data, includedSlots)
            mstore(add(data, 0x20), paidExtraSlots)
            mstore(add(data, 0x40), maxExecutors)
            mstore(add(data, 0x60), slotAuthorizationId)
            mstore(add(data, 0x80), paymentReceiptHash)
            log2(data, 0xa0, 0xabbe88df6b45f15906e3a8cb97a6be59321abdb4448528f1b1714ad653410abd, taskId)
        }
        uint256 count = agentRegistry.agentCount();
        if (count < EVALUATOR_COUNT) revert InvalidEvaluation();
        publisherStakeBasis[taskId] = stakeManager.stakeOf(positionId);
        stakeManager.consumeCredit(positionId, taskId, msg.sender);
        protocolEconomics.freezeTaskSource(taskId, msg.sender);
        uint256 evaluationCharge = stakeManager.chargeLifecycleFee(
            positionId, taskId, ProtocolEconomics.LifecycleStage.Evaluation, publisherStakeBasis[taskId]
        );
        uint256 evaluatorPool = evaluationCharge
            - (evaluationCharge * 2_000) / BPS
            - (evaluationCharge * 2_000) / BPS
            - (evaluationCharge * 1_500) / BPS
            - (evaluationCharge * 1_000) / BPS;
        rewardVault.registerEvaluationFee(taskId, evaluatorPool);
        emit TaskEvaluationFeeCharged(taskId, positionId, evaluationCharge, address(protocolEconomics));
        EvaluationSelection storage selection = evaluationSelections[taskId];
        bytes32 poolId = _evaluationPoolId(taskId);
        selection.candidateCount = count;
        selection.deadline = block.timestamp + EVALUATION_WINDOW;
        selection.candidateSetHash = agentRegistry.registryHash();
        selection.selectionProof = poolId;
        agentRegistry.startSelectionPool(poolId, taskId, agentRegistry.CAPABILITY_EVALUATE(), true);
        emit TaskEvaluationRequested(
            taskId,
            msg.sender,
            positionId,
            specHash,
            0,
            selection.candidateSetHash,
            count,
            selection.deadline
        );
        emit TaskExecutionModeSet(taskId, mode);
        emit TaskTesterCapabilitiesSet(taskId, requiredTesterCapabilities);
    }

    /// @dev Each call performs at most three logarithmic draws and 16 persistent
    /// live-safety/conflict prunes in total. A caller may retry without rebuilding
    /// the frozen all-candidate pool.
    function finalizeEvaluationPanel(uint256 taskId) external {
        Task storage task = tasks[taskId];
        EvaluationSelection storage selection = evaluationSelections[taskId];
        if (
            task.state != State.Evaluating || selection.panelFinalized ||
            block.timestamp > selection.deadline
        ) revert InvalidEvaluation();
        bytes32 poolId = selection.selectionProof;
        if (poolId == bytes32(0)) revert InvalidEvaluation();
        (address[3] memory selected, bool finalized, uint256 selectionBlock, bytes32 proof, bytes32 successorPoolId) =
            agentRegistry.drawSelectionPanel(poolId, 16);
        if (!finalized) {
            if (successorPoolId != bytes32(0)) selection.selectionProof = successorPoolId;
            return;
        }
        for (uint8 slot; slot < EVALUATOR_COUNT; ++slot) {
            taskEvaluators[taskId][slot] = selected[slot];
            isTaskEvaluator[taskId][selected[slot]] = true;
        }
        selection.selectionBlock = selectionBlock;
        selection.selectionProof = proof;
        selection.panelFinalized = true;
        emit TaskEvaluatorsAssigned(taskId, selected[0], selected[1], selected[2], proof);
    }

    function submitEvaluation(
        uint256 taskId,
        bytes32 categoryHash,
        uint16 difficultyBps,
        uint32 estimatedHours,
        uint16 testabilityBps,
        uint256 recommendedReward,
        bool approve,
        bytes32 reportHash
    ) external {
        Task storage task = tasks[taskId];
        EvaluationSelection storage selection = evaluationSelections[taskId];
        if (
            task.state != State.Evaluating || !selection.panelFinalized ||
            block.timestamp > selection.deadline || !isTaskEvaluator[taskId][msg.sender] ||
            !agentRegistry.isEligibleFor(msg.sender, agentRegistry.CAPABILITY_EVALUATE())
        ) revert InvalidEvaluation();
        EvaluationReport storage report = evaluationReports[taskId][msg.sender];
        if (
            report.submitted || categoryHash == bytes32(0) || difficultyBps > BPS ||
            estimatedHours == 0 || testabilityBps > BPS || recommendedReward == 0 || reportHash == bytes32(0)
        ) revert InvalidEvaluation();
        evaluationReports[taskId][msg.sender] = EvaluationReport({
            categoryHash: categoryHash,
            difficultyBps: difficultyBps,
            estimatedHours: estimatedHours,
            testabilityBps: testabilityBps,
            recommendedReward: recommendedReward,
            approve: approve,
            reportHash: reportHash,
            submitted: true
        });
        selection.reportCount += 1;
        if (approve) selection.approveCount += 1;
        emit TaskEvaluationSubmitted(taskId, msg.sender, approve, categoryHash, reportHash);
    }

    function finalizeTaskEvaluation(uint256 taskId) external {
        Task storage task = tasks[taskId];
        EvaluationSelection storage selection = evaluationSelections[taskId];
        if (task.state != State.Evaluating || !selection.panelFinalized || block.timestamp > selection.deadline) revert InvalidEvaluation();
        // All reports are required for unbiased medians, except that two rejections
        // make approval mathematically impossible and can release the position early.
        if (selection.reportCount != EVALUATOR_COUNT && selection.approveCount + (EVALUATOR_COUNT - selection.reportCount) >= 2) {
            revert InvalidEvaluation();
        }
        if (selection.approveCount < 2) {
            _rejectEvaluation(taskId, task);
            return;
        }
        (bool consensus, EvaluationResult memory result) = _aggregateApprovedEvaluation(taskId, selection.approveCount);
        if (!consensus) {
            _rejectEvaluation(taskId, task);
            return;
        }
        uint256 finalReward = task.requestedReward < result.recommendedReward ? task.requestedReward : result.recommendedReward;
        evaluationResults[taskId] = result;
        task.requestedReward = finalReward;
        uint256 publicationFee = stakeManager.chargeLifecycleFee(
            task.positionId, taskId, ProtocolEconomics.LifecycleStage.Publication, publisherStakeBasis[taskId]
        );
        if (publicationFee == 0) revert InvalidState();
        taskPublicationFee[taskId] = publicationFee;
        _settleEvaluationFee(taskId);
        task.state = State.Open;
        emit TaskPublicationFeeCharged(taskId, task.positionId, publicationFee, address(protocolEconomics));
        emit TaskEvaluationFinalized(taskId, true, result.categoryHash, result.difficultyBps, result.estimatedHours, result.testabilityBps, finalReward);
        emit TaskCreated(taskId, task.publisher, task.positionId, task.specHash);
    }

    function expireTaskEvaluation(uint256 taskId) external {
        Task storage task = tasks[taskId];
        EvaluationSelection storage selection = evaluationSelections[taskId];
        if (task.state != State.Evaluating || block.timestamp <= selection.deadline) revert InvalidEvaluation();
        _settleEvaluationFee(taskId);
        stakeManager.releasePosition(task.positionId, taskId);
        task.state = State.Rejected;
        emit TaskEvaluationExpired(taskId);
        emit TaskEvaluationFinalized(taskId, false, bytes32(0), 0, 0, 0, task.requestedReward);
    }

    function _rejectEvaluation(uint256 taskId, Task storage task) private {
        _settleEvaluationFee(taskId);
        stakeManager.releasePosition(task.positionId, taskId);
        task.state = State.Rejected;
        emit TaskEvaluationFinalized(taskId, false, bytes32(0), 0, 0, 0, task.requestedReward);
    }

    function _aggregateApprovedEvaluation(uint256 taskId, uint8 approveCount) private view returns (bool, EvaluationResult memory result) {
        EvaluationReport[3] memory approved;
        uint256 found;
        for (uint256 i; i < EVALUATOR_COUNT; ++i) {
            EvaluationReport memory report = evaluationReports[taskId][taskEvaluators[taskId][i]];
            if (report.approve) approved[found++] = report;
        }
        if (found != approveCount || found < 2) return (false, result);
        if (found == 2) {
            if (approved[0].categoryHash != approved[1].categoryHash) return (false, result);
            result = EvaluationResult({
                categoryHash: approved[0].categoryHash,
                difficultyBps: approved[0].difficultyBps > approved[1].difficultyBps ? approved[0].difficultyBps : approved[1].difficultyBps,
                estimatedHours: approved[0].estimatedHours > approved[1].estimatedHours ? approved[0].estimatedHours : approved[1].estimatedHours,
                testabilityBps: approved[0].testabilityBps < approved[1].testabilityBps ? approved[0].testabilityBps : approved[1].testabilityBps,
                recommendedReward: approved[0].recommendedReward < approved[1].recommendedReward ? approved[0].recommendedReward : approved[1].recommendedReward
            });
            return (true, result);
        }
        bytes32 categoryHash;
        if (approved[0].categoryHash == approved[1].categoryHash || approved[0].categoryHash == approved[2].categoryHash) categoryHash = approved[0].categoryHash;
        else if (approved[1].categoryHash == approved[2].categoryHash) categoryHash = approved[1].categoryHash;
        else return (false, result);
        result = EvaluationResult({
            categoryHash: categoryHash,
            difficultyBps: uint16(_median(approved[0].difficultyBps, approved[1].difficultyBps, approved[2].difficultyBps)),
            estimatedHours: uint32(_median(approved[0].estimatedHours, approved[1].estimatedHours, approved[2].estimatedHours)),
            testabilityBps: uint16(_median(approved[0].testabilityBps, approved[1].testabilityBps, approved[2].testabilityBps)),
            recommendedReward: _median(approved[0].recommendedReward, approved[1].recommendedReward, approved[2].recommendedReward)
        });
        return (true, result);
    }

    function _median(uint256 a, uint256 b, uint256 c) private pure returns (uint256) {
        if (a > b) (a, b) = (b, a);
        if (b > c) (b, c) = (c, b);
        if (a > b) (a, b) = (b, a);
        return b;
    }

    function _settleEvaluationFee(uint256 taskId) private {
        EvaluationSelection storage selection = evaluationSelections[taskId];
        address[] memory reporters = new address[](selection.reportCount);
        uint256 reporterIndex;
        for (uint256 i; i < EVALUATOR_COUNT; ++i) {
            address evaluator = taskEvaluators[taskId][i];
            if (evaluator != address(0) && evaluationReports[taskId][evaluator].submitted) reporters[reporterIndex++] = evaluator;
        }
        rewardVault.settleEvaluationFee(taskId, reporters);
    }

    function claimTask(uint256 taskId) external {
        Task storage task = tasks[taskId];
        if (task.state != State.Open && task.state != State.Claimed && task.state != State.Correction) revert InvalidState();
        if (task.teamClosed || task.executorCount >= task.maxExecutors || isTaskExecutor[taskId][msg.sender]) revert InvalidState();
        if (msg.sender == task.publisher || isTaskEvaluator[taskId][msg.sender]) revert Unauthorized();
        if (!agentRegistry.isEligibleFor(msg.sender, agentRegistry.CAPABILITY_EXECUTE())) revert Unauthorized();
        if (task.executor == address(0)) task.executor = msg.sender;
        taskExecutors[taskId].push(msg.sender);
        executorClaimedAt[taskId][msg.sender] = block.timestamp;
        if (task.executorCount == 0) teamFormationStartedAt[taskId] = block.timestamp;
        isTaskExecutor[taskId][msg.sender] = true;
        task.executorCount += 1;
        task.teamHash = keccak256(abi.encode(task.teamHash, msg.sender));
        task.state = State.Claimed;
        emit TaskClaimed(taskId, msg.sender);
        if (task.executorCount == task.maxExecutors) {
            task.teamClosed = true;
            _canonicalizeTeam(taskId, task);
            emit TeamClosed(taskId, task.executorCount);
        }
    }

    function closeTeam(uint256 taskId) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.executor && msg.sender != coordinator) revert Unauthorized();
        if (block.timestamp < teamFormationStartedAt[taskId] + TEAM_FORMATION_WINDOW) revert InvalidState();
        if (task.state != State.Claimed || task.teamClosed || task.executorCount == 0) revert InvalidState();
        task.teamClosed = true;
        _canonicalizeTeam(taskId, task);
        emit TeamClosed(taskId, task.executorCount);
        _emitTeamReadyIfComplete(taskId, task);
    }

    /// @notice Anyone may advance this objective timeout. The configured
    /// coordinator is an automation convenience, not a liveness gate.
    function evictInactiveExecutor(uint256 taskId, address executor) external {
        Task storage task = tasks[taskId];
        if ((task.state != State.Claimed && task.state != State.Correction) || !isTaskExecutor[taskId][executor]) revert InvalidState();
        if (contributionRound[taskId][executor] == task.workRound || block.timestamp < executorClaimedAt[taskId][executor] + EXECUTOR_INACTIVITY_WINDOW) revert InvalidState();
        address[] storage executors = taskExecutors[taskId];
        for (uint256 i; i < executors.length; ++i) {
            if (executors[i] == executor) { executors[i] = executors[executors.length - 1]; executors.pop(); break; }
        }
        isTaskExecutor[taskId][executor] = false;
        task.executorCount -= 1;
        task.executor = executors.length == 0 ? address(0) : executors[0];
        task.teamHash = bytes32(0);
        task.teamClosed = false;
        teamFormationStartedAt[taskId] = block.timestamp;
        emit ExecutorEvicted(taskId, executor);
    }

    function submitContribution(uint256 taskId, bytes32 hash) external {
        Task storage task = tasks[taskId];
        if (!isTaskExecutor[taskId][msg.sender]) revert Unauthorized();
        if ((task.state != State.Claimed && task.state != State.Correction) || hash == bytes32(0)) revert InvalidState();
        if (teamReadyRound[taskId] == task.workRound) revert InvalidState();
        if (contributionRound[taskId][msg.sender] != task.workRound) {
            contributionRound[taskId][msg.sender] = task.workRound;
            task.contributionCount += 1;
        }
        contributionHash[taskId][msg.sender] = hash;
        emit ContributionSubmitted(taskId, msg.sender, task.workRound, hash);
        _emitTeamReadyIfComplete(taskId, task);
    }

    function _emitTeamReadyIfComplete(uint256 taskId, Task storage task) private {
        if (!task.teamClosed || task.contributionCount != task.executorCount || teamReadyRound[taskId] == task.workRound) return;
        teamReadyRound[taskId] = task.workRound;
        if (taskExecutionMode[taskId] == ExecutionMode.Competition) {
            task.state = State.Submitted;
            emit CompetitionReady(taskId, task.workRound, task.executorCount);
        } else if (task.maxExecutors > 1) {
            emit TeamReady(taskId, task.executor, task.workRound);
        }
    }

    function _canonicalizeTeam(uint256 taskId, Task storage task) private {
        // Preserve claim order because executor weights are submitted against
        // getTaskExecutors(taskId).  Sort only an in-memory copy so the
        // collaboration key cannot be changed by claiming in a new order.
        address[] memory canonical = taskExecutors[taskId];
        for (uint256 i = 1; i < canonical.length; ++i) {
            address value = canonical[i];
            uint256 j = i;
            while (j != 0 && uint160(canonical[j - 1]) > uint160(value)) {
                canonical[j] = canonical[j - 1];
                unchecked { --j; }
            }
            canonical[j] = value;
        }
        task.teamHash = keccak256(abi.encode(canonical));
    }

    function submitWork(uint256 taskId, bytes32 artifactHash) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.executor) revert Unauthorized();
        if (taskExecutionMode[taskId] != ExecutionMode.Collaboration) revert InvalidState();
        if ((task.state != State.Claimed && task.state != State.Correction) || !task.teamClosed) revert InvalidState();
        if (task.contributionCount != task.executorCount || artifactHash == bytes32(0)) revert InvalidState();
        task.artifactHash = artifactHash;
        task.state = State.Submitted;
        emit WorkSubmitted(taskId, artifactHash);
    }

    /// @dev Locks the append-only registered-agent set before future entropy exists.
    /// BSC mainnet production should replace blockhash entropy with VRF.
    /// @notice Permissionless because the candidate snapshot, future block and
    /// task state fully determine the draw. No caller chooses a validator.
    function requestTester(uint256 taskId) external {
        Task storage task = tasks[taskId];
        _requestTester(taskId, task);
    }

    function _requestTester(uint256 taskId, Task storage task) private {
        if (task.state != State.Submitted) revert InvalidState();
        bytes32 poolId = task.selectionProof;
        if (task.selectionProof != bytes32(0)) {
            (uint256 selectionBlock, , uint8 selectedCount, bool complete, bytes32 drawProof, , , ) = agentRegistry.selectionPoolStatus(poolId);
            if (
                !complete || selectedCount != 0 ||
                drawProof != bytes32(0) || block.number <= selectionBlock + 256
            ) revert InvalidState();
            agentRegistry.rescheduleSelectionPool(poolId);
            return;
        }
        uint256 count = agentRegistry.agentCount();
        if (count < 3) revert InvalidTesterSet();
        poolId = _testerPoolId(taskId, task.workRound, maintenanceRepairCheckpoint[taskId]);
        task.testerCandidateCount = count;
        task.candidateSetHash = agentRegistry.registryHash();
        task.selectionProof = poolId;
        agentRegistry.startSelectionPool(poolId, taskId, taskRequiredTesterCapabilities[taskId], false);
    }

    /// @notice Permissionless finalization prevents a coordinator outage from
    /// stranding a valid future-block draw.
    function finalizeTester(uint256 taskId) external {
        Task storage task = tasks[taskId];
        bytes32 poolId = task.selectionProof;
        if (poolId == bytes32(0)) revert InvalidState();
        if (address(verificationPanel) == address(0)) revert InvalidState();
        (address[3] memory testers, bool finalized, uint256 selectionBlock, bytes32 proof, bytes32 successorPoolId) =
            agentRegistry.drawSelectionPanel(poolId, 16);
        if (!finalized) {
            if (successorPoolId != bytes32(0)) task.selectionProof = successorPoolId;
            return;
        }
        task.testerSelectionBlock = selectionBlock;
        taskTesters[taskId] = testers;
        task.tester = testers[0];
        task.selectionProof = proof;
        task.state = State.Testing;
        uint8 checkpoint = maintenanceRepairCheckpoint[taskId];
        _startVerificationPanel(taskId, task, testers, checkpoint);
        emit TesterPanelAssigned(taskId, testers[0], testers[1], testers[2], proof, task.workRound);
    }

    function finalizeVerificationPanel(
        uint256 taskId, uint32 workRound, uint8 checkpoint, bool passed,
        address winner, bytes32 selectedArtifactHash, bytes32 aggregateEvidenceHash,
        uint16[] calldata executorWeightsBps, address[3] calldata testers, uint16[3] calldata testerRewardWeightsBps
    ) external {
        if (msg.sender != address(verificationPanel)) revert Unauthorized();
        Task storage task = tasks[taskId];
        if (workRound != task.workRound || aggregateEvidenceHash == bytes32(0)) revert InvalidState();
        for (uint8 i; i < 3; ++i) if (testers[i] != taskTesters[taskId][i] || testerRewardWeightsBps[i] == 0) revert InvalidTesterSet();
        task.evidenceHash = aggregateEvidenceHash;
        if (checkpoint != maintenanceRepairCheckpoint[taskId] || task.state != State.Testing) revert InvalidState();
        if (passed) {
            if (executorWeightsBps.length != task.executorCount) revert InvalidExecutorWeights();
            taskExecutorWeightsBps[taskId] = executorWeightsBps;
            if (checkpoint == 0 && taskExecutionMode[taskId] == ExecutionMode.Competition) {
                if (winner == address(0) || !isTaskExecutor[taskId][winner] || contributionRound[taskId][winner] != task.workRound || contributionHash[taskId][winner] != selectedArtifactHash) revert InvalidState();
                competitionWinner[taskId] = winner;
                task.artifactHash = selectedArtifactHash;
            } else if (winner != address(0) || selectedArtifactHash != bytes32(0)) revert InvalidState();
            _finishSuccessfulTest(taskId, task, aggregateEvidenceHash);
        } else {
            _beginCorrection(taskId, task);
            if (checkpoint != 0) {
                emit MaintenanceValidated(taskId, checkpoint, false, aggregateEvidenceHash);
                emit MaintenanceRepairRequested(taskId, checkpoint, task.workRound, aggregateEvidenceHash);
            }
        }
        if (checkpoint == 0 && taskExecutionMode[taskId] == ExecutionMode.Competition) emit CompetitionResultSubmitted(taskId, passed, passed ? winner : address(0), passed ? selectedArtifactHash : bytes32(0), aggregateEvidenceHash);
        else emit TestSubmitted(taskId, passed, aggregateEvidenceHash);
    }

    function _resetTesterSelection(uint256 taskId, Task storage task) private {
        task.tester = address(0);
        task.testerSelectionBlock = 0;
        task.testerCandidateCount = 0;
        task.candidateSetHash = bytes32(0);
        task.selectionProof = bytes32(0);
    }

    function _beginCorrection(uint256 taskId, Task storage task) private {
        task.state = State.Correction;
        task.workRound += 1;
        task.contributionCount = 0;
        task.artifactHash = bytes32(0);
        delete taskTesters[taskId];
        _resetTesterSelection(taskId, task);
        address[] storage executors = taskExecutors[taskId];
        for (uint256 i; i < executors.length; ++i) executorClaimedAt[taskId][executors[i]] = block.timestamp;
    }

    function _collaborationKey(Task storage task) private view returns (bytes32) {
        return keccak256(abi.encode(task.publisher, task.teamHash, task.tester));
    }

    function _finishSuccessfulTest(uint256 taskId, Task storage task, bytes32 evidenceHash) private {
        uint8 checkpoint = maintenanceRepairCheckpoint[taskId];
        if (checkpoint == 0) {
            task.state = State.UserReview;
            return;
        }
        maintenanceRepairCheckpoint[taskId] = 0;
        maintenanceEvidence[taskId][checkpoint] = evidenceHash;
        rewardVault.updateFutureParticipants(taskId, checkpoint, taskExecutors[taskId], taskExecutorWeightsBps[taskId], task.tester);
        rewardVault.approveCheckpoint(taskId, checkpoint);
        task.state = checkpoint == 3 ? State.Completed : State.Maintenance;
        if (checkpoint == 3) stakeManager.releasePosition(task.positionId, taskId);
        emit MaintenanceValidated(taskId, checkpoint, true, evidenceHash);
    }

    function review(uint256 taskId, bool accepted, bytes32 reasonHash) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.publisher) revert Unauthorized();
        if (task.state != State.UserReview) revert InvalidState();
        if (!accepted) {
            if (reasonHash == bytes32(0)) revert InvalidState();
            task.state = State.Rejected;
            rejectionDisputes[taskId] = RejectionDispute(reasonHash, bytes32(0), block.timestamp);
            emit UserReviewed(taskId, false, reasonHash);
            return;
        }
        task.state = State.Maintenance;
        _chargeSuccessfulLifecycle(taskId, task);
        bytes32 collaborationKey = _collaborationKey(task);
        rewardVault.createGrant(
            taskId,
            taskExecutors[taskId],
            taskExecutorWeightsBps[taskId],
            task.tester,
            collaborationKey,
            task.requestedReward,
            publisherStakeBasis[taskId]
        );
        emit UserReviewed(taskId, true, bytes32(0));
    }

    function respondToRejection(uint256 taskId, bytes32 responseHash) external {
        Task storage task = tasks[taskId];
        RejectionDispute storage dispute = rejectionDisputes[taskId];
        address responder = taskExecutionMode[taskId] == ExecutionMode.Competition ? competitionWinner[taskId] : task.executor;
        if (msg.sender != responder) revert Unauthorized();
        if (task.state != State.Rejected || responseHash == bytes32(0) || dispute.responseHash != bytes32(0)) revert InvalidState();
        if (block.timestamp > dispute.openedAt + REJECTION_RESPONSE_WINDOW) revert InvalidState();
        dispute.responseHash = responseHash;
        emit RejectionResponded(taskId, msg.sender, responseHash);
    }

    function resolveRejection(uint256 taskId, bool executorWins, bytes32 resolutionHash) external onlyDisputeResolver {
        Task storage task = tasks[taskId];
        RejectionDispute storage dispute = rejectionDisputes[taskId];
        if (task.state != State.Rejected || resolutionHash == bytes32(0)) revert InvalidState();
        if (dispute.responseHash == bytes32(0) && block.timestamp <= dispute.openedAt + REJECTION_RESPONSE_WINDOW) revert InvalidState();
        uint256 publisherSlash;
        if (executorWins) {
            _chargeSuccessfulLifecycle(taskId, task);
            bytes32 collaborationKey = _collaborationKey(task);
            rewardVault.createGrant(taskId, taskExecutors[taskId], taskExecutorWeightsBps[taskId], task.tester, collaborationKey, task.requestedReward, publisherStakeBasis[taskId]);
            publisherSlash = (stakeManager.stakeOf(task.positionId) * ABUSIVE_REJECTION_SLASH_BPS) / BPS;
            if (publisherSlash != 0) stakeManager.slashPosition(task.positionId, taskId, publisherSlash, address(rewardVault));
            task.state = State.Maintenance;
        } else {
            stakeManager.releasePosition(task.positionId, taskId);
        }
        emit RejectionResolved(taskId, executorWins, resolutionHash, publisherSlash);
    }

    function _chargeSuccessfulLifecycle(uint256 taskId, Task storage task) private {
        stakeManager.chargeLifecycleFee(
            task.positionId, taskId, ProtocolEconomics.LifecycleStage.Acceptance, publisherStakeBasis[taskId]
        );
        stakeManager.chargeLifecycleFee(
            task.positionId, taskId, ProtocolEconomics.LifecycleStage.Maintenance, publisherStakeBasis[taskId]
        );
    }

    /// @notice Anyone may start an ordered, due maintenance checkpoint. The
    /// chain enforces due time, order and one active panel.
    function requestMaintenancePanel(uint256 taskId, uint8 checkpoint) external {
        Task storage task = tasks[taskId];
        if (task.state != State.Maintenance || checkpoint == 0 || checkpoint > 3) revert InvalidState();
        if (maintenanceEvidence[taskId][checkpoint] != bytes32(0)) revert InvalidState();
        if (checkpoint > 1 && maintenanceEvidence[taskId][checkpoint - 1] == bytes32(0)) revert InvalidState();
        if (block.timestamp < rewardVault.checkpointDueAt(taskId, checkpoint)) revert InvalidState();
        maintenanceRepairCheckpoint[taskId] = checkpoint;
        // Maintenance can happen months after the acceptance panel.  Reusing
        // that panel would bypass current eligibility/quality and can deadlock
        // the checkpoint after a validator exits or is banned.  Move through
        // the same frozen, weighted selection protocol as initial testing.
        delete taskTesters[taskId];
        _resetTesterSelection(taskId, task);
        task.state = State.Submitted;
        emit MaintenancePanelRequested(taskId, checkpoint, task.workRound);
        _requestTester(taskId, task);
    }

    function _startVerificationPanel(uint256 taskId, Task storage task, address[3] memory testers, uint8 checkpoint) private {
        bytes32[3] memory scopes = [
            keccak256(abi.encode(task.specHash, task.workRound, checkpoint, uint8(0))),
            keccak256(abi.encode(task.specHash, task.workRound, checkpoint, uint8(1))),
            keccak256(abi.encode(task.specHash, task.workRound, checkpoint, uint8(2)))
        ];
        uint16[3] memory masks = [uint16(3), uint16(5), uint16(6)];
        verificationPanel.startPanel(taskId, task.workRound, checkpoint, task.executorCount, testers, 7, masks, scopes);
    }

    function _evaluationPoolId(uint256 taskId) private view returns (bytes32) {
        return keccak256(abi.encode(address(this), taskId, uint8(1)));
    }

    function _testerPoolId(uint256 taskId, uint32 workRound, uint8 checkpoint) private view returns (bytes32) {
        return keccak256(abi.encode(address(this), taskId, workRound, checkpoint, uint8(2)));
    }

    function isAgentSelectionConflict(uint256 taskId, address candidate, bool evaluatorPanel) external view returns (bool) {
        Task storage task = tasks[taskId];
        return candidate == task.publisher || (!evaluatorPanel && (isTaskExecutor[taskId][candidate] || isTaskEvaluator[taskId][candidate]));
    }

    function getTaskExecutors(uint256 taskId) external view returns (address[] memory) {
        return taskExecutors[taskId];
    }

    function getTaskEvaluators(uint256 taskId) external view returns (address[3] memory) {
        return taskEvaluators[taskId];
    }

    function getTaskTesters(uint256 taskId) external view returns (address[3] memory) {
        return taskTesters[taskId];
    }

    function getTaskExecutorWeightsBps(uint256 taskId) external view returns (uint16[] memory) {
        return taskExecutorWeightsBps[taskId];
    }
}
