// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Deterministic task-fee routing and source vesting. This contract does
/// not perform swaps, advertise a price, or give paid sources protocol influence.
contract ProtocolEconomics is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    uint16 public constant AGENT_POOL_BPS = 9_500;
    uint16 public constant DAO_REWARD_BPS = 300;
    uint16 public constant SOURCE_REWARD_BPS = 200;
    uint32 public constant MIN_VESTING = 180 days;
    uint32 public constant MAX_VESTING = 365 days;
    address public constant PERMANENT_BURN_SINK = 0x000000000000000000000000000000000000dEaD;

    enum LifecycleStage { Evaluation, Publication, Acceptance, Maintenance }

    struct Source {
        address recipient;
        bool active;
    }

    struct TaskSource {
        bytes32 sourceId;
        address recipient;
        uint64 frozenAt;
    }

    struct Vesting {
        address recipient;
        uint128 amount;
        uint64 unlockAt;
        bool claimed;
    }

    IERC20 public immutable token;
    address public immutable rewardVault;
    address public immutable daoTreasury;
    address public immutable securityReserve;
    address public immutable burnSink;
    uint32 public immutable vestingDuration;
    address public taskRegistry;
    address public stakeManager;

    mapping(bytes32 => Source) public sources;
    mapping(address => bytes32) public pendingTaskSource;
    mapping(uint256 => TaskSource) public taskSources;
    mapping(uint256 => bool) public taskRewardRouted;
    mapping(uint256 => uint8) public consumedLifecycleStages;
    mapping(bytes32 => Vesting) public vestings;

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyConfigured();
    error SourceAlreadyFrozen();
    error SourceNotFrozen();
    error StageAlreadyConsumed();
    error InvalidAmount();
    error AlreadyClaimed();
    error StillLocked();

    event SourceConfigured(bytes32 indexed sourceId, address indexed recipient, bool active);
    event TaskSourceCommitted(address indexed publisher, bytes32 indexed sourceId);
    event TaskSourceFrozen(
        uint256 indexed taskId, bytes32 indexed requestedSourceId, bytes32 indexed effectiveSourceId,
        address recipient, bool fallbackToDao
    );
    event TaskRewardRouted(
        uint256 indexed taskId, uint256 grossReward, uint256 agentPool,
        uint256 daoAmount, uint256 sourceAmount, bytes32 daoVestingId, bytes32 sourceVestingId
    );
    event LifecycleChargeRouted(
        uint256 indexed taskId, LifecycleStage indexed stage, uint256 stakeBasis, uint256 amount,
        uint256 rewardVaultAmount, uint256 burnAmount, uint256 daoAmount,
        uint256 sourceAmount, uint256 securityAmount, bytes32 daoVestingId, bytes32 sourceVestingId
    );
    event VestingCreated(bytes32 indexed vestingId, address indexed recipient, uint256 amount, uint256 unlockAt);
    event VestingClaimed(bytes32 indexed vestingId, address indexed recipient, uint256 amount);

    constructor(
        IERC20 token_, address rewardVault_, address daoTreasury_, address securityReserve_,
        address burnSink_, uint32 vestingDuration_, address initialOwner
    ) Ownable(initialOwner) {
        if (
            address(token_) == address(0) || rewardVault_ == address(0) || daoTreasury_ == address(0) ||
            securityReserve_ == address(0) || burnSink_ != PERMANENT_BURN_SINK ||
            rewardVault_ == daoTreasury_ || rewardVault_ == securityReserve_ || daoTreasury_ == securityReserve_ ||
            vestingDuration_ < MIN_VESTING || vestingDuration_ > MAX_VESTING
        ) revert InvalidConfiguration();
        token = token_;
        rewardVault = rewardVault_;
        daoTreasury = daoTreasury_;
        securityReserve = securityReserve_;
        burnSink = burnSink_;
        vestingDuration = vestingDuration_;
    }

    function configureProtocol(address taskRegistry_, address stakeManager_) external onlyOwner {
        if (taskRegistry != address(0) || stakeManager != address(0)) revert AlreadyConfigured();
        if (taskRegistry_ == address(0) || stakeManager_ == address(0)) revert InvalidConfiguration();
        taskRegistry = taskRegistry_;
        stakeManager = stakeManager_;
    }

    function configureSource(bytes32 sourceId, address recipient, bool active) external onlyOwner {
        if (sourceId == bytes32(0) || recipient == address(0)) revert InvalidConfiguration();
        sources[sourceId] = Source(recipient, active);
        emit SourceConfigured(sourceId, recipient, active);
    }

    /// @notice A publisher binds the source for its next task. TaskRegistry
    /// consumes and clears this value during task creation, preventing a source
    /// from being substituted after the task id or outcome is known.
    function commitNextTaskSource(bytes32 sourceId) external {
        pendingTaskSource[msg.sender] = sourceId;
        emit TaskSourceCommitted(msg.sender, sourceId);
    }

    /// @dev Invalid, inactive, or self-referring sources deterministically fall
    /// back to the DAO. The effective recipient can never be changed afterwards.
    function freezeTaskSource(uint256 taskId, address publisher) external {
        if (msg.sender != taskRegistry) revert Unauthorized();
        if (taskSources[taskId].frozenAt != 0) revert SourceAlreadyFrozen();
        bytes32 requestedSourceId = pendingTaskSource[publisher];
        delete pendingTaskSource[publisher];
        Source memory requested = sources[requestedSourceId];
        bool fallbackToDao = !requested.active || requested.recipient == address(0) || requested.recipient == publisher;
        bytes32 effectiveId = fallbackToDao ? bytes32(0) : requestedSourceId;
        address recipient = fallbackToDao ? daoTreasury : requested.recipient;
        taskSources[taskId] = TaskSource(effectiveId, recipient, uint64(block.timestamp));
        emit TaskSourceFrozen(taskId, requestedSourceId, effectiveId, recipient, fallbackToDao);
    }

    /// @notice Pulls exactly the 5% network allocation from RewardVault. Agent
    /// accounting remains in RewardVault and is returned.
    function routeTaskReward(uint256 taskId, uint256 grossReward, uint256 fundedAmount)
        external nonReentrant returns (uint256 agentPool)
    {
        if (msg.sender != rewardVault) revert Unauthorized();
        TaskSource memory taskSource = _taskSource(taskId);
        if (taskRewardRouted[taskId]) revert StageAlreadyConsumed();
        uint256 daoAmount = (grossReward * DAO_REWARD_BPS) / BPS;
        uint256 sourceAmount = (grossReward * SOURCE_REWARD_BPS) / BPS;
        agentPool = grossReward - daoAmount - sourceAmount;
        if (fundedAmount != daoAmount + sourceAmount) revert InvalidAmount();
        token.safeTransferFrom(msg.sender, address(this), fundedAmount);
        taskRewardRouted[taskId] = true;

        bytes32 daoVestingId = keccak256(abi.encode("TASK_REWARD_DAO", taskId));
        bytes32 sourceVestingId = keccak256(abi.encode("TASK_REWARD_SOURCE", taskId));
        _createVesting(daoVestingId, daoTreasury, daoAmount);
        _createVesting(sourceVestingId, taskSource.recipient, sourceAmount);
        emit TaskRewardRouted(taskId, grossReward, agentPool, daoAmount, sourceAmount, daoVestingId, sourceVestingId);
    }

    /// @notice Pulls the exact charge atomically from StakeCreditManager. Each
    /// task/stage can be consumed only once.
    function routeLifecycleCharge(
        uint256 taskId, LifecycleStage stage, uint256 stakeBasis, uint256 fundedAmount
    ) external nonReentrant {
        if (msg.sender != stakeManager) revert Unauthorized();
        TaskSource memory taskSource = _taskSource(taskId);
        uint8 bit = uint8(1 << uint8(stage));
        if (consumedLifecycleStages[taskId] & bit != 0) revert StageAlreadyConsumed();
        uint256 amount = (stakeBasis * _stageBps(stage)) / BPS;
        if (amount == 0 || fundedAmount != amount) revert InvalidAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        consumedLifecycleStages[taskId] |= bit;

        uint256 burnAmount = (amount * 2_000) / BPS;
        uint256 daoAmount = (amount * 2_000) / BPS;
        uint256 sourceAmount = (amount * 1_500) / BPS;
        uint256 securityAmount = (amount * 1_000) / BPS;
        uint256 rewardVaultAmount = amount - burnAmount - daoAmount - sourceAmount - securityAmount;
        bytes32 daoVestingId = keccak256(abi.encode("LIFECYCLE_DAO", taskId, stage));
        bytes32 sourceVestingId = keccak256(abi.encode("LIFECYCLE_SOURCE", taskId, stage));
        _createVesting(daoVestingId, daoTreasury, daoAmount);
        _createVesting(sourceVestingId, taskSource.recipient, sourceAmount);

        if (rewardVaultAmount != 0) token.safeTransfer(rewardVault, rewardVaultAmount);
        if (burnAmount != 0) token.safeTransfer(burnSink, burnAmount);
        if (securityAmount != 0) token.safeTransfer(securityReserve, securityAmount);
        emit LifecycleChargeRouted(
            taskId, stage, stakeBasis, amount, rewardVaultAmount, burnAmount,
            daoAmount, sourceAmount, securityAmount, daoVestingId, sourceVestingId
        );
    }

    function claimVesting(bytes32 vestingId) external nonReentrant {
        Vesting storage vesting = vestings[vestingId];
        if (vesting.recipient != msg.sender) revert Unauthorized();
        if (vesting.claimed || vesting.amount == 0) revert AlreadyClaimed();
        if (block.timestamp < vesting.unlockAt) revert StillLocked();
        vesting.claimed = true;
        token.safeTransfer(msg.sender, vesting.amount);
        emit VestingClaimed(vestingId, msg.sender, vesting.amount);
    }

    function lifecycleChargeFor(uint256 stakeBasis, LifecycleStage stage) external pure returns (uint256) {
        return (stakeBasis * _stageBps(stage)) / BPS;
    }

    function _taskSource(uint256 taskId) private view returns (TaskSource memory taskSource) {
        taskSource = taskSources[taskId];
        if (taskSource.frozenAt == 0) revert SourceNotFrozen();
    }

    function _stageBps(LifecycleStage stage) private pure returns (uint16) {
        if (stage == LifecycleStage.Evaluation) return 20;
        if (stage == LifecycleStage.Publication) return 30;
        if (stage == LifecycleStage.Acceptance) return 70;
        return 30;
    }

    function _createVesting(bytes32 vestingId, address recipient, uint256 amount) private {
        if (amount == 0) return;
        if (amount > type(uint128).max) revert InvalidAmount();
        if (vestings[vestingId].recipient != address(0)) revert StageAlreadyConsumed();
        uint64 unlockAt = uint64(block.timestamp + vestingDuration);
        vestings[vestingId] = Vesting(recipient, uint128(amount), unlockAt, false);
        emit VestingCreated(vestingId, recipient, amount, unlockAt);
    }
}
