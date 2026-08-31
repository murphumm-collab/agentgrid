// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {StakeCreditManager} from "./StakeCreditManager.sol";
import {RewardVault} from "./RewardVault.sol";
import {AgentRegistry} from "./AgentRegistry.sol";

contract TaskRegistry is Ownable {
    uint256 public constant ABUSIVE_REJECTION_SLASH_BPS = 500;
    uint256 public constant BPS = 10_000;
    uint256 public constant REJECTION_RESPONSE_WINDOW = 3 days;
    uint256 public constant TEAM_FORMATION_WINDOW = 1 days;
    uint256 public constant EXECUTOR_INACTIVITY_WINDOW = 6 hours;
    uint256 public constant MIN_PUBLICATION_FEE = 10 ether;
    uint256 public constant PUBLICATION_FEE_BPS = 200;
    uint256 public constant MAX_STAKE_FEE_BPS = 1_000;
    uint256 public constant EVALUATION_SELECTION_DELAY = 5;
    uint256 public constant EVALUATION_WINDOW = 3 days;
    uint256 public constant EVALUATION_FEE = 3 ether;
    uint8 public constant EVALUATOR_COUNT = 3;
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
    address public coordinator;
    address public disputeResolver;
    address public publicationFeeRecipient;
    uint256 public nextTaskId = 1;
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => ExecutionMode) private taskExecutionMode;
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
    event TestSubmitted(uint256 indexed taskId, bool passed, bytes32 evidenceHash);
    event CompetitionResultSubmitted(uint256 indexed taskId, bool passed, address indexed winner, bytes32 artifactHash, bytes32 evidenceHash);
    event UserReviewed(uint256 indexed taskId, bool accepted, bytes32 reasonHash);
    event RejectionResponded(uint256 indexed taskId, address indexed executor, bytes32 responseHash);
    event MaintenanceValidated(uint256 indexed taskId, uint8 indexed checkpoint, bool passed, bytes32 evidenceHash);
    event MaintenanceRepairRequested(uint256 indexed taskId, uint8 indexed checkpoint, uint32 indexed workRound, bytes32 evidenceHash);
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
        publicationFeeRecipient = address(rewardVault_);
    }

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert Unauthorized();
        _;
    }

    modifier onlyDisputeResolver() {
        if (msg.sender != disputeResolver) revert Unauthorized();
        _;
    }

    function setCoordinator(address newCoordinator) external onlyOwner {
        if (newCoordinator == address(0)) revert Unauthorized();
        coordinator = newCoordinator;
    }

    function setDisputeResolver(address newResolver) external onlyOwner {
        if (newResolver == address(0)) revert Unauthorized();
        disputeResolver = newResolver;
    }

    function setPublicationFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert Unauthorized();
        publicationFeeRecipient = newRecipient;
    }

    function publicationFeeFor(uint256 positionId, uint256 requestedReward) public view returns (uint256 fee) {
        uint256 stake = stakeManager.stakeOf(positionId);
        fee = (requestedReward * PUBLICATION_FEE_BPS) / BPS;
        if (fee < MIN_PUBLICATION_FEE) fee = MIN_PUBLICATION_FEE;
        uint256 cap = (stake * MAX_STAKE_FEE_BPS) / BPS;
        if (fee > cap) fee = cap;
    }

    function createTaskWithMode(
        uint256 positionId,
        bytes32 specHash,
        uint256 requestedReward,
        uint8 maxExecutors,
        ExecutionMode mode
    ) external returns (uint256 taskId) {
        return _createTask(positionId, specHash, requestedReward, maxExecutors, mode);
    }

    function _createTask(
        uint256 positionId,
        bytes32 specHash,
        uint256 requestedReward,
        uint8 maxExecutors,
        ExecutionMode mode
    ) private returns (uint256 taskId) {
        if (stakeManager.ownerOf(positionId) != msg.sender) revert Unauthorized();
        if (specHash == bytes32(0) || requestedReward == 0 || maxExecutors == 0 || maxExecutors > 32) revert InvalidState();
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
        uint256 count = agentRegistry.agentCount();
        if (count < EVALUATOR_COUNT) revert InvalidEvaluation();
        uint256 eligibleEvaluatorCount;
        for (uint256 i; i < count && eligibleEvaluatorCount < EVALUATOR_COUNT; ++i) {
            address candidate = agentRegistry.agentAt(i);
            if (candidate != msg.sender && agentRegistry.isEligibleFor(candidate, agentRegistry.CAPABILITY_EVALUATE())) eligibleEvaluatorCount += 1;
        }
        if (eligibleEvaluatorCount < EVALUATOR_COUNT) revert InvalidEvaluation();
        publisherStakeBasis[taskId] = stakeManager.stakeOf(positionId);
        stakeManager.consumeCredit(positionId, taskId, msg.sender);
        stakeManager.chargeEvaluationFee(positionId, taskId, EVALUATION_FEE, address(rewardVault));
        rewardVault.registerEvaluationFee(taskId, EVALUATION_FEE);
        emit TaskEvaluationFeeCharged(taskId, positionId, EVALUATION_FEE, address(rewardVault));
        EvaluationSelection storage selection = evaluationSelections[taskId];
        selection.selectionBlock = block.number + EVALUATION_SELECTION_DELAY;
        selection.candidateCount = count;
        selection.deadline = block.timestamp + EVALUATION_WINDOW;
        selection.candidateSetHash = agentRegistry.registryHash();
        emit TaskEvaluationRequested(
            taskId,
            msg.sender,
            positionId,
            specHash,
            selection.selectionBlock,
            selection.candidateSetHash,
            count,
            selection.deadline
        );
        emit TaskExecutionModeSet(taskId, mode);
    }

    /// @dev Selects a stable three-agent panel from a candidate snapshot committed
    /// before the future block entropy exists. BSC mainnet should use VRF.
    function finalizeEvaluationPanel(uint256 taskId) external {
        Task storage task = tasks[taskId];
        EvaluationSelection storage selection = evaluationSelections[taskId];
        if (
            task.state != State.Evaluating || selection.panelFinalized ||
            block.timestamp > selection.deadline || block.number <= selection.selectionBlock ||
            block.number > selection.selectionBlock + 256
        ) revert InvalidEvaluation();
        bytes32 proof = keccak256(
            abi.encode(blockhash(selection.selectionBlock), taskId, selection.candidateSetHash, selection.candidateCount, "EVALUATOR_PANEL")
        );
        address[3] memory selected;
        for (uint256 slot; slot < EVALUATOR_COUNT; ++slot) {
            uint256 start = uint256(keccak256(abi.encode(proof, slot))) % selection.candidateCount;
            for (uint256 offset; offset < selection.candidateCount; ++offset) {
                address candidate = agentRegistry.agentAt((start + offset) % selection.candidateCount);
                bool duplicate;
                for (uint256 previous; previous < slot; ++previous) {
                    if (selected[previous] == candidate) { duplicate = true; break; }
                }
                if (candidate != task.publisher && !duplicate && agentRegistry.isEligibleFor(candidate, agentRegistry.CAPABILITY_EVALUATE())) {
                    selected[slot] = candidate;
                    break;
                }
            }
            if (selected[slot] == address(0)) revert InvalidEvaluation();
            taskEvaluators[taskId][slot] = selected[slot];
            isTaskEvaluator[taskId][selected[slot]] = true;
        }
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
        uint256 publicationFee = publicationFeeFor(task.positionId, finalReward);
        if (publicationFee == 0) revert InvalidState();
        taskPublicationFee[taskId] = publicationFee;
        stakeManager.chargePublicationFee(task.positionId, taskId, publicationFee, publicationFeeRecipient);
        _settleEvaluationFee(taskId);
        task.state = State.Open;
        emit TaskPublicationFeeCharged(taskId, task.positionId, publicationFee, publicationFeeRecipient);
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

    function evictInactiveExecutor(uint256 taskId, address executor) external onlyCoordinator {
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
    function requestTester(uint256 taskId) external onlyCoordinator {
        Task storage task = tasks[taskId];
        if (task.state != State.Submitted) revert InvalidState();
        if (task.testerSelectionBlock != 0 && block.number <= task.testerSelectionBlock + 256) revert InvalidState();
        uint256 count = agentRegistry.agentCount();
        if (count == 0) revert InvalidTesterSet();
        task.testerSelectionBlock = block.number + 5;
        task.testerCandidateCount = count;
        task.candidateSetHash = agentRegistry.registryHash();
        emit TesterRequested(taskId, task.testerSelectionBlock, task.candidateSetHash, count);
    }

    function finalizeTester(uint256 taskId) external onlyCoordinator {
        Task storage task = tasks[taskId];
        uint256 selectionBlock = task.testerSelectionBlock;
        if (task.state != State.Submitted || selectionBlock == 0 || block.number <= selectionBlock || block.number > selectionBlock + 256) revert InvalidState();
        bytes32 proof = keccak256(abi.encode(blockhash(selectionBlock), taskId, task.candidateSetHash, task.testerCandidateCount));
        uint256 start = uint256(proof) % task.testerCandidateCount;
        address tester;
        for (uint256 i; i < task.testerCandidateCount; ++i) {
            address candidate = agentRegistry.agentAt((start + i) % task.testerCandidateCount);
            if (
                candidate != task.publisher && !isTaskExecutor[taskId][candidate] && !isTaskEvaluator[taskId][candidate] &&
                agentRegistry.isEligibleFor(candidate, agentRegistry.CAPABILITY_TEST())
            ) {
                tester = candidate;
                break;
            }
        }
        if (tester == address(0)) revert InvalidTesterSet();
        task.tester = tester;
        task.selectionProof = proof;
        task.state = State.Testing;
        emit TesterAssigned(taskId, tester, proof);
    }

    function submitTest(uint256 taskId, bool passed, bytes32 evidenceHash, uint16[] calldata executorWeightsBps) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.tester) revert Unauthorized();
        if (task.state != State.Testing || taskExecutionMode[taskId] != ExecutionMode.Collaboration || evidenceHash == bytes32(0)) revert InvalidState();
        task.evidenceHash = evidenceHash;
        if (passed) {
            _storeExecutorWeights(taskId, task.executorCount, executorWeightsBps);
            _finishSuccessfulTest(taskId, task, evidenceHash);
        }
        else {
            _beginCorrection(taskId, task);
        }
        emit TestSubmitted(taskId, passed, evidenceHash);
    }

    function submitCompetitionTest(
        uint256 taskId,
        bool passed,
        address winner,
        bytes32 selectedArtifactHash,
        bytes32 evidenceHash,
        uint16[] calldata executorWeightsBps
    ) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.tester) revert Unauthorized();
        if (task.state != State.Testing || taskExecutionMode[taskId] != ExecutionMode.Competition || evidenceHash == bytes32(0)) revert InvalidState();
        task.evidenceHash = evidenceHash;
        if (passed) {
            if (
                winner == address(0) || !isTaskExecutor[taskId][winner] ||
                contributionRound[taskId][winner] != task.workRound ||
                selectedArtifactHash == bytes32(0) || contributionHash[taskId][winner] != selectedArtifactHash
            ) revert InvalidState();
            _storeExecutorWeights(taskId, task.executorCount, executorWeightsBps);
            competitionWinner[taskId] = winner;
            task.artifactHash = selectedArtifactHash;
            _finishSuccessfulTest(taskId, task, evidenceHash);
        } else {
            if (winner != address(0) || selectedArtifactHash != bytes32(0) || executorWeightsBps.length != 0) revert InvalidExecutorWeights();
            competitionWinner[taskId] = address(0);
            _beginCorrection(taskId, task);
        }
        emit CompetitionResultSubmitted(taskId, passed, winner, selectedArtifactHash, evidenceHash);
    }

    function _storeExecutorWeights(uint256 taskId, uint8 executorCount, uint16[] calldata executorWeightsBps) private {
        if (executorWeightsBps.length != executorCount) revert InvalidExecutorWeights();
        uint256 totalWeightBps;
        for (uint256 i; i < executorWeightsBps.length; ++i) totalWeightBps += executorWeightsBps[i];
        if (totalWeightBps != BPS) revert InvalidExecutorWeights();
        taskExecutorWeightsBps[taskId] = executorWeightsBps;
    }

    function _resetTesterSelection(Task storage task) private {
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
        _resetTesterSelection(task);
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

    function validateMaintenance(uint256 taskId, uint8 checkpoint, bool passed, bytes32 evidenceHash) external {
        Task storage task = tasks[taskId];
        if (msg.sender != task.tester) revert Unauthorized();
        if (task.state != State.Maintenance || checkpoint == 0 || checkpoint > 3) revert InvalidState();
        if (evidenceHash == bytes32(0) || maintenanceEvidence[taskId][checkpoint] != bytes32(0)) revert InvalidState();
        if (checkpoint > 1 && maintenanceEvidence[taskId][checkpoint - 1] == bytes32(0)) revert InvalidState();
        if (block.timestamp < rewardVault.checkpointDueAt(taskId, checkpoint)) revert InvalidState();
        if (!passed) {
            maintenanceRepairCheckpoint[taskId] = checkpoint;
            _beginCorrection(taskId, task);
            emit MaintenanceValidated(taskId, checkpoint, false, evidenceHash);
            emit MaintenanceRepairRequested(taskId, checkpoint, task.workRound, evidenceHash);
            return;
        }
        rewardVault.approveCheckpoint(taskId, checkpoint);
        maintenanceEvidence[taskId][checkpoint] = evidenceHash;
        if (checkpoint == 3) {
            task.state = State.Completed;
            stakeManager.releasePosition(task.positionId, taskId);
        }
        emit MaintenanceValidated(taskId, checkpoint, true, evidenceHash);
    }

    function getTaskExecutors(uint256 taskId) external view returns (address[] memory) {
        return taskExecutors[taskId];
    }

    function getTaskEvaluators(uint256 taskId) external view returns (address[3] memory) {
        return taskEvaluators[taskId];
    }

    function getTaskExecutorWeightsBps(uint256 taskId) external view returns (uint16[] memory) {
        return taskExecutorWeightsBps[taskId];
    }
}
