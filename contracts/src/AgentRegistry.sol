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
    mapping(address => uint256) public agentPosition;
    mapping(uint256 => address) public positionAgent;
    mapping(address => uint8) public agentCapabilities;
    address[] private registeredAgents;
    bytes32 public registryHash;

    error Unauthorized();
    error PositionAlreadyBound();
    error ExistingRegistrationActive();

    event AgentRegistered(address indexed agent, uint256 indexed positionId, uint256 stake);
    event AgentCapabilitiesUpdated(address indexed agent, uint8 capabilities);

    constructor(StakeCreditManager stakeManager_) {
        stakeManager = stakeManager_;
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
        return owner == agent && amount >= stakeManager.MINIMUM_STAKE() && withdrawalRequestedAt == 0;
    }

    function isEligibleFor(address agent, uint8 capability) public view returns (bool) {
        return capability != 0 && (agentCapabilities[agent] & capability) == capability && isEligible(agent);
    }
}
