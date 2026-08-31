// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StakeCreditManager} from "./StakeCreditManager.sol";

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
    StakeCreditManager public immutable stakeManager;
    address public taskRegistry;
    mapping(address => uint256) public agentPosition;
    mapping(uint256 => address) public positionAgent;
    mapping(address => uint8) public agentCapabilities;
    mapping(uint256 => mapping(address => uint256)) public taskPosition;
    address[] private registeredAgents;
    bytes32 public registryHash;

    error Unauthorized();
    error PositionAlreadyBound();
    error ExistingRegistrationActive();
    error RegistryAlreadySet();

    event AgentRegistered(address indexed agent, uint256 indexed positionId, uint256 stake);
    event AgentCapabilitiesUpdated(address indexed agent, uint8 capabilities);

    constructor(StakeCreditManager stakeManager_) {
        stakeManager = stakeManager_;
    }

    modifier onlyRegistry() {
        if (msg.sender != taskRegistry) revert Unauthorized();
        _;
    }

    function setTaskRegistry(address registry) external {
        if (msg.sender != stakeManager.owner() || registry == address(0)) revert Unauthorized();
        if (taskRegistry != address(0)) revert RegistryAlreadySet();
        taskRegistry = registry;
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
        agentPosition[msg.sender] = positionId;
        positionAgent[positionId] = msg.sender;
        agentCapabilities[msg.sender] = capabilities;
        if (previous == 0) registeredAgents.push(msg.sender);
        registryHash = keccak256(abi.encode(registryHash, msg.sender, positionId));
        emit AgentRegistered(msg.sender, positionId, amount);
        emit AgentCapabilitiesUpdated(msg.sender, capabilities);
    }

    function agentCount() external view returns (uint256) {
        return registeredAgents.length;
    }

    function agentAt(uint256 index) external view returns (address) {
        return registeredAgents[index];
    }

    function isEligible(address agent) public view returns (bool) {
        uint256 positionId = agentPosition[agent];
        if (positionId == 0) return false;
        (address owner, uint256 amount, , , uint256 withdrawalRequestedAt) = stakeManager.positions(positionId);
        return owner == agent && amount >= stakeManager.MINIMUM_STAKE() && withdrawalRequestedAt == 0 &&
            stakeManager.availableTaskCollateral(positionId) >= stakeManager.TASK_COLLATERAL();
    }

    function isEligibleFor(address agent, uint8 capability) public view returns (bool) {
        return capability != 0 && (agentCapabilities[agent] & capability) == capability && isEligible(agent);
    }

    function lockForTask(uint256 taskId, address participant) external onlyRegistry returns (uint256 positionId) {
        positionId = agentPosition[participant];
        if (positionId == 0 || taskPosition[taskId][participant] != 0) revert Unauthorized();
        stakeManager.lockPositionForTask(positionId, taskId, participant);
        taskPosition[taskId][participant] = positionId;
    }

    function unlockForTask(uint256 taskId, address participant) external onlyRegistry {
        if (participant == address(0)) return;
        uint256 positionId = taskPosition[taskId][participant];
        if (positionId == 0) return;
        stakeManager.unlockPositionForTask(positionId, taskId, participant);
        delete taskPosition[taskId][participant];
    }

    function slashForTask(uint256 taskId, address participant, uint256 slashBps, address recipient)
        external onlyRegistry returns (uint256 slashAmount)
    {
        uint256 positionId = taskPosition[taskId][participant];
        if (positionId == 0 || slashBps == 0 || slashBps > 10_000) revert Unauthorized();
        slashAmount = (stakeManager.stakeOf(positionId) * slashBps) / 10_000;
        if (slashAmount != 0) stakeManager.slashPosition(positionId, taskId, slashAmount, recipient);
    }
}
