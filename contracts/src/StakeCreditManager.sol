// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ProtocolEconomics} from "./ProtocolEconomics.sol";

contract StakeCreditManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_STAKE = 1_000 ether;
    uint256 public constant CREDIT_LIFETIME = 30 days;
    uint256 public constant WITHDRAWAL_DELAY = 7 days;

    struct Position {
        address owner;
        uint256 amount;
        uint256 activeTaskId;
        uint256 creditExpiry;
        uint256 withdrawalRequestedAt;
    }

    IERC20 public immutable token;
    address public taskRegistry;
    address public qualitySlasher;
    ProtocolEconomics public protocolEconomics;
    uint256 public nextPositionId = 1;
    mapping(uint256 => Position) public positions;

    error Unauthorized();
    error InvalidAmount();
    error PositionBusy();
    error CreditUnavailable();
    error WithdrawalNotReady();
    error RegistryAlreadySet();

    event PositionCreated(uint256 indexed positionId, address indexed owner, uint256 amount);
    event CreditIssued(uint256 indexed positionId, uint256 expiresAt);
    event CreditConsumed(uint256 indexed positionId, uint256 indexed taskId);
    event PositionReleased(uint256 indexed positionId, uint256 indexed taskId);
    event PositionSlashed(uint256 indexed positionId, uint256 indexed taskId, uint256 amount, address indexed recipient);
    event PublicationFeeCharged(uint256 indexed positionId, uint256 indexed taskId, uint256 amount, address indexed recipient);
    event EvaluationFeeCharged(uint256 indexed positionId, uint256 indexed taskId, uint256 amount, address indexed recipient);
    event PositionWithdrawn(uint256 indexed positionId, address indexed owner, uint256 amount);
    event LifecycleFeeCharged(uint256 indexed positionId, uint256 indexed taskId, ProtocolEconomics.LifecycleStage indexed stage, uint256 stakeBasis, uint256 amount);

    constructor(IERC20 token_, address initialOwner) Ownable(initialOwner) {
        token = token_;
    }

    modifier onlyRegistry() {
        if (msg.sender != taskRegistry) revert Unauthorized();
        _;
    }

    modifier onlyPositionOwner(uint256 positionId) {
        if (positions[positionId].owner != msg.sender) revert Unauthorized();
        _;
    }

    function setTaskRegistry(address registry) external onlyOwner {
        if (registry == address(0)) revert Unauthorized();
        if (taskRegistry != address(0)) revert RegistryAlreadySet();
        taskRegistry = registry;
    }

    function setProtocolEconomics(ProtocolEconomics economics) external onlyOwner {
        if (address(economics) == address(0)) revert Unauthorized();
        if (address(protocolEconomics) != address(0)) revert RegistryAlreadySet();
        protocolEconomics = economics;
        token.forceApprove(address(economics), type(uint256).max);
    }

    function setQualitySlasher(address slasher) external onlyOwner {
        if (slasher == address(0) || slasher.code.length == 0 || qualitySlasher != address(0)) revert RegistryAlreadySet();
        qualitySlasher = slasher;
    }

    function createPosition(uint256 amount) external nonReentrant returns (uint256 positionId) {
        if (amount < MINIMUM_STAKE) revert InvalidAmount();
        positionId = nextPositionId++;
        positions[positionId] = Position(msg.sender, amount, 0, 0, 0);
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit PositionCreated(positionId, msg.sender, amount);
    }

    function increaseStake(uint256 positionId, uint256 amount) external onlyPositionOwner(positionId) nonReentrant {
        if (amount == 0) revert InvalidAmount();
        positions[positionId].amount += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function issueCredit(uint256 positionId) external onlyPositionOwner(positionId) {
        Position storage position = positions[positionId];
        if (position.amount < MINIMUM_STAKE) revert InvalidAmount();
        if (position.activeTaskId != 0 || position.withdrawalRequestedAt != 0) revert PositionBusy();
        position.creditExpiry = block.timestamp + CREDIT_LIFETIME;
        emit CreditIssued(positionId, position.creditExpiry);
    }

    function consumeCredit(uint256 positionId, uint256 taskId, address publisher) external onlyRegistry {
        Position storage position = positions[positionId];
        if (position.owner != publisher) revert Unauthorized();
        if (position.activeTaskId != 0 || position.creditExpiry < block.timestamp) revert CreditUnavailable();
        position.activeTaskId = taskId;
        position.creditExpiry = 0;
        emit CreditConsumed(positionId, taskId);
    }

    function releasePosition(uint256 positionId, uint256 taskId) external onlyRegistry {
        Position storage position = positions[positionId];
        if (position.activeTaskId != taskId) revert Unauthorized();
        position.activeTaskId = 0;
        emit PositionReleased(positionId, taskId);
    }

    function slashPosition(uint256 positionId, uint256 taskId, uint256 amount, address recipient) external onlyRegistry nonReentrant {
        Position storage position = positions[positionId];
        if (position.activeTaskId != taskId || recipient == address(0) || amount == 0 || amount > position.amount) revert InvalidAmount();
        position.amount -= amount;
        token.safeTransfer(recipient, amount);
        emit PositionSlashed(positionId, taskId, amount, recipient);
    }

    /// @notice Slashes an Agent's registry stake after a canonical upheld
    /// quality arbitration. Unlike publisher task slashing, Agent positions do
    /// not carry the challenged task as their activeTaskId.
    function slashAgentPosition(uint256 positionId, uint256 amount, address recipient) external nonReentrant {
        if (msg.sender != qualitySlasher || recipient == address(0) || amount == 0) revert Unauthorized();
        Position storage position = positions[positionId];
        if (position.owner == address(0) || amount > position.amount) revert InvalidAmount();
        position.amount -= amount;
        token.safeTransfer(recipient, amount);
        emit PositionSlashed(positionId, 0, amount, recipient);
    }

    function chargePublicationFee(uint256 positionId, uint256 taskId, uint256 amount, address recipient) external onlyRegistry nonReentrant {
        Position storage position = positions[positionId];
        if (position.activeTaskId != taskId || recipient == address(0) || amount == 0 || amount > position.amount) revert InvalidAmount();
        position.amount -= amount;
        token.safeTransfer(recipient, amount);
        emit PublicationFeeCharged(positionId, taskId, amount, recipient);
    }

    function chargeEvaluationFee(uint256 positionId, uint256 taskId, uint256 amount, address recipient) external onlyRegistry nonReentrant {
        Position storage position = positions[positionId];
        if (position.activeTaskId != taskId || recipient == address(0) || amount == 0 || amount > position.amount) revert InvalidAmount();
        position.amount -= amount;
        token.safeTransfer(recipient, amount);
        emit EvaluationFeeCharged(positionId, taskId, amount, recipient);
    }

    function chargeLifecycleFee(
        uint256 positionId, uint256 taskId, ProtocolEconomics.LifecycleStage stage, uint256 stakeBasis
    ) external onlyRegistry nonReentrant returns (uint256 amount) {
        Position storage position = positions[positionId];
        if (position.activeTaskId != taskId || address(protocolEconomics) == address(0)) revert InvalidAmount();
        amount = protocolEconomics.lifecycleChargeFor(stakeBasis, stage);
        if (amount == 0 || amount > position.amount) revert InvalidAmount();
        position.amount -= amount;
        protocolEconomics.routeLifecycleCharge(taskId, stage, stakeBasis, amount);
        emit LifecycleFeeCharged(positionId, taskId, stage, stakeBasis, amount);
    }

    function requestWithdrawal(uint256 positionId) external onlyPositionOwner(positionId) {
        Position storage position = positions[positionId];
        if (position.activeTaskId != 0) revert PositionBusy();
        position.withdrawalRequestedAt = block.timestamp;
        position.creditExpiry = 0;
    }

    function executeWithdrawal(uint256 positionId) external onlyPositionOwner(positionId) nonReentrant {
        Position storage position = positions[positionId];
        if (
            position.withdrawalRequestedAt == 0 ||
            block.timestamp < position.withdrawalRequestedAt + WITHDRAWAL_DELAY
        ) revert WithdrawalNotReady();
        uint256 amount = position.amount;
        position.amount = 0;
        position.withdrawalRequestedAt = 0;
        token.safeTransfer(msg.sender, amount);
        emit PositionWithdrawn(positionId, msg.sender, amount);
    }

    function ownerOf(uint256 positionId) external view returns (address) {
        return positions[positionId].owner;
    }

    function stakeOf(uint256 positionId) external view returns (uint256) {
        return positions[positionId].amount;
    }
}
