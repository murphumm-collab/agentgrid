// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract RewardVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant EPOCH_DURATION = 30 days;
    uint256 public constant STAKE_CAP_BPS = 2_000;
    uint256 public constant EXECUTOR_BPS = 6_500;
    uint256 public constant TESTER_BPS = 1_500;
    uint256 public constant BPS = 10_000;

    struct Grant {
        address[] executors;
        uint16[] executorWeightsBps;
        address tester;
        uint256 startedAt;
        uint256 total;
        uint256[4] amounts;
        bool[4] approved;
        bool[4] claimed;
    }

    IERC20 public immutable token;
    address public immutable reserve;
    uint256 public immutable epochBudget;
    address public taskRegistry;
    mapping(uint256 => uint256) public epochSpent;
    mapping(bytes32 => uint256) public collaborationCount;
    mapping(uint256 => Grant) private grants;
    mapping(uint256 => uint256) public evaluationFees;
    mapping(uint256 => bool) public evaluationFeeSettled;
    mapping(uint256 => mapping(uint8 => address[])) private checkpointExecutors;
    mapping(uint256 => mapping(uint8 => uint16[])) private checkpointExecutorWeightsBps;
    mapping(uint256 => mapping(uint8 => address)) private checkpointTesters;

    error Unauthorized();
    error GrantExists();
    error EmptyReward();
    error InvalidExecutorWeights();
    error InvalidCheckpoint();
    error CheckpointNotDue();
    error AlreadyClaimed();
    error RegistryAlreadySet();

    event GrantCreated(uint256 indexed taskId, uint256 grossReward, uint256 multiplierBps, bytes32 issuanceProof);
    event FutureParticipantsUpdated(
        uint256 indexed taskId,
        uint8 indexed fromCheckpoint,
        address[] executors,
        uint16[] executorWeightsBps,
        address tester,
        bytes32 indexed executorWeightsHash
    );
    event CheckpointApproved(uint256 indexed taskId, uint8 indexed checkpoint);
    event RewardClaimed(uint256 indexed taskId, uint8 indexed checkpoint, uint256 amount);
    event ExecutorRewardPaid(uint256 indexed taskId, uint8 indexed checkpoint, address indexed executor, uint256 amount);
    event EvaluationFeeRegistered(uint256 indexed taskId, uint256 amount);
    event EvaluationFeePaid(uint256 indexed taskId, address indexed evaluator, uint256 amount);
    event EvaluationFeeSettled(uint256 indexed taskId, uint256 reporterCount, uint256 reserveAmount);

    constructor(IERC20 token_, address reserve_, uint256 epochBudget_, address initialOwner) Ownable(initialOwner) {
        token = token_;
        reserve = reserve_;
        epochBudget = epochBudget_;
    }

    modifier onlyRegistry() {
        if (msg.sender != taskRegistry) revert Unauthorized();
        _;
    }

    function setTaskRegistry(address registry) external onlyOwner {
        if (registry == address(0)) revert Unauthorized();
        if (taskRegistry != address(0)) revert RegistryAlreadySet();
        taskRegistry = registry;
    }

    /// @notice Accounts for tokens already transferred by StakeCreditManager.
    function registerEvaluationFee(uint256 taskId, uint256 amount) external onlyRegistry {
        if (amount == 0 || evaluationFees[taskId] != 0 || evaluationFeeSettled[taskId]) revert EmptyReward();
        evaluationFees[taskId] = amount;
        emit EvaluationFeeRegistered(taskId, amount);
    }

    /// @notice Pays only evaluators who actually submitted a report. Any rounding
    /// remainder, or the entire fee when nobody reported, returns to reserve.
    function settleEvaluationFee(uint256 taskId, address[] calldata reporters) external onlyRegistry nonReentrant {
        uint256 amount = evaluationFees[taskId];
        if (amount == 0 || evaluationFeeSettled[taskId]) revert AlreadyClaimed();
        evaluationFeeSettled[taskId] = true;
        uint256 paid;
        if (reporters.length != 0) {
            uint256 share = amount / reporters.length;
            for (uint256 i; i < reporters.length; ++i) {
                if (reporters[i] == address(0)) revert EmptyReward();
                token.safeTransfer(reporters[i], share);
                paid += share;
                emit EvaluationFeePaid(taskId, reporters[i], share);
            }
        }
        uint256 reserveAmount = amount - paid;
        if (reserveAmount != 0) token.safeTransfer(reserve, reserveAmount);
        emit EvaluationFeeSettled(taskId, reporters.length, reserveAmount);
    }

    function createGrant(
        uint256 taskId,
        address[] calldata executors,
        uint16[] calldata executorWeightsBps,
        address tester,
        bytes32 collaborationKey,
        uint256 requestedReward,
        uint256 publisherStake
    ) external onlyRegistry returns (uint256 grossReward) {
        if (grants[taskId].startedAt != 0) revert GrantExists();
        if (executors.length == 0 || executors.length > 32) revert EmptyReward();
        if (executorWeightsBps.length != executors.length) revert InvalidExecutorWeights();
        uint256 totalWeightBps;
        for (uint256 i; i < executorWeightsBps.length; ++i) {
            totalWeightBps += executorWeightsBps[i];
        }
        if (totalWeightBps != BPS) revert InvalidExecutorWeights();
        uint256 count = collaborationCount[collaborationKey];
        uint256 multiplierBps = count == 0 ? 10_000 : count == 1 ? 7_000 : count == 2 ? 4_000 : count == 3 ? 2_000 : 1_000;
        uint256 stakeCap = (publisherStake * STAKE_CAP_BPS) / BPS;
        uint256 epoch = block.timestamp / EPOCH_DURATION;
        uint256 available = epochBudget > epochSpent[epoch] ? epochBudget - epochSpent[epoch] : 0;
        uint256 baseReward = requestedReward > stakeCap ? stakeCap : requestedReward;
        grossReward = (baseReward * multiplierBps) / BPS;
        if (grossReward > available) grossReward = available;
        if (grossReward == 0) revert EmptyReward();

        Grant storage grant = grants[taskId];
        grant.executors = executors;
        grant.executorWeightsBps = executorWeightsBps;
        grant.tester = tester;
        grant.startedAt = block.timestamp;
        grant.total = grossReward;
        grant.amounts[0] = (grossReward * 4_000) / BPS;
        grant.amounts[1] = (grossReward * 2_000) / BPS;
        grant.amounts[2] = (grossReward * 2_000) / BPS;
        grant.amounts[3] = grossReward - grant.amounts[0] - grant.amounts[1] - grant.amounts[2];
        grant.approved[0] = true;
        epochSpent[epoch] += grossReward;
        collaborationCount[collaborationKey] = count + 1;

        bytes32 proof = keccak256(abi.encode(block.chainid, address(this), taskId, grossReward, collaborationKey));
        emit GrantCreated(taskId, grossReward, multiplierBps, proof);
    }

    function approveCheckpoint(uint256 taskId, uint8 checkpoint) external onlyRegistry {
        Grant storage grant = grants[taskId];
        if (checkpoint == 0 || checkpoint > 3) revert InvalidCheckpoint();
        if (block.timestamp < dueAt(grant.startedAt, checkpoint)) revert CheckpointNotDue();
        grant.approved[checkpoint] = true;
        emit CheckpointApproved(taskId, checkpoint);
    }

    /// @notice Rebinds only unclaimed future maintenance rewards after an
    /// independently verified repair. Already claimed tranches are immutable.
    function updateFutureParticipants(
        uint256 taskId,
        uint8 fromCheckpoint,
        address[] calldata executors,
        uint16[] calldata executorWeightsBps,
        address tester
    ) external onlyRegistry {
        Grant storage grant = grants[taskId];
        if (grant.startedAt == 0 || fromCheckpoint == 0 || fromCheckpoint > 3) revert InvalidCheckpoint();
        if (executors.length == 0 || executors.length > 32 || tester == address(0)) revert EmptyReward();
        if (executorWeightsBps.length != executors.length) revert InvalidExecutorWeights();
        uint256 totalWeightBps;
        for (uint256 i; i < executors.length; ++i) {
            if (executors[i] == address(0)) revert EmptyReward();
            totalWeightBps += executorWeightsBps[i];
        }
        if (totalWeightBps != BPS) revert InvalidExecutorWeights();
        for (uint8 checkpoint = fromCheckpoint; checkpoint <= 3; ++checkpoint) {
            if (grant.claimed[checkpoint]) continue;
            delete checkpointExecutors[taskId][checkpoint];
            delete checkpointExecutorWeightsBps[taskId][checkpoint];
            for (uint256 i; i < executors.length; ++i) {
                checkpointExecutors[taskId][checkpoint].push(executors[i]);
                checkpointExecutorWeightsBps[taskId][checkpoint].push(executorWeightsBps[i]);
            }
            checkpointTesters[taskId][checkpoint] = tester;
        }
        emit FutureParticipantsUpdated(taskId, fromCheckpoint, executors, executorWeightsBps, tester, keccak256(abi.encode(executors, executorWeightsBps, tester)));
    }

    function claim(uint256 taskId, uint8 checkpoint) external nonReentrant {
        Grant storage grant = grants[taskId];
        if (checkpoint > 3 || grant.startedAt == 0) revert InvalidCheckpoint();
        if (!grant.approved[checkpoint] || block.timestamp < dueAt(grant.startedAt, checkpoint)) {
            revert CheckpointNotDue();
        }
        if (grant.claimed[checkpoint]) revert AlreadyClaimed();
        grant.claimed[checkpoint] = true;
        uint256 amount = grant.amounts[checkpoint];
        uint256 executorPool = (amount * EXECUTOR_BPS) / BPS;
        uint256 testerAmount = (amount * TESTER_BPS) / BPS;
        uint256 executorsPaid;
        address[] storage overriddenExecutors = checkpointExecutors[taskId][checkpoint];
        uint16[] storage overriddenWeights = checkpointExecutorWeightsBps[taskId][checkpoint];
        uint256 executorCount = overriddenExecutors.length == 0 ? grant.executors.length : overriddenExecutors.length;
        for (uint256 i; i < executorCount; ++i) {
            address executor = overriddenExecutors.length == 0 ? grant.executors[i] : overriddenExecutors[i];
            uint16 weight = overriddenWeights.length == 0 ? grant.executorWeightsBps[i] : overriddenWeights[i];
            uint256 executorAmount = (executorPool * weight) / BPS;
            token.safeTransfer(executor, executorAmount);
            executorsPaid += executorAmount;
            emit ExecutorRewardPaid(taskId, checkpoint, executor, executorAmount);
        }
        address checkpointTester = checkpointTesters[taskId][checkpoint];
        token.safeTransfer(checkpointTester == address(0) ? grant.tester : checkpointTester, testerAmount);
        token.safeTransfer(reserve, amount - executorsPaid - testerAmount);
        emit RewardClaimed(taskId, checkpoint, amount);
    }

    function dueAt(uint256 startedAt, uint8 checkpoint) public pure returns (uint256) {
        if (checkpoint == 0) return startedAt;
        if (checkpoint == 1) return startedAt + 7 days;
        if (checkpoint == 2) return startedAt + 30 days;
        if (checkpoint == 3) return startedAt + 90 days;
        revert InvalidCheckpoint();
    }

    function checkpointDueAt(uint256 taskId, uint8 checkpoint) external view returns (uint256) {
        uint256 startedAt = grants[taskId].startedAt;
        if (startedAt == 0) revert InvalidCheckpoint();
        return dueAt(startedAt, checkpoint);
    }

    function getGrant(uint256 taskId) external view returns (Grant memory) {
        return grants[taskId];
    }

    function getCheckpointParticipants(uint256 taskId, uint8 checkpoint) external view returns (address[] memory executors, uint16[] memory weights, address tester) {
        if (checkpoint > 3) revert InvalidCheckpoint();
        if (checkpointExecutors[taskId][checkpoint].length == 0) {
            Grant storage grant = grants[taskId];
            return (grant.executors, grant.executorWeightsBps, grant.tester);
        }
        return (checkpointExecutors[taskId][checkpoint], checkpointExecutorWeightsBps[taskId][checkpoint], checkpointTesters[taskId][checkpoint]);
    }
}
