// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ITaskRegistryDisputes {
    function resolveRejection(uint256 taskId, bool executorWins, bytes32 resolutionHash) external;
}

/// @notice Quorum arbitrator adapter. Each arbitrator has one vote per task and
/// all quorum votes must commit to the same outcome and evidence hash.
contract DisputeResolver is Ownable {
    ITaskRegistryDisputes public immutable registry;
    uint256 public immutable quorum;
    mapping(address => bool) public isArbitrator;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => bytes32)) public proposalByArbitrator;
    mapping(uint256 => mapping(bytes32 => uint256)) public voteCount;
    mapping(uint256 => bool) public resolved;

    error Unauthorized();
    error InvalidConfiguration();
    error AlreadyVoted();
    error NoVote();
    error AlreadyResolved();

    event ResolutionVote(uint256 indexed taskId, address indexed arbitrator, bool executorWins, bytes32 resolutionHash, uint256 votes);
    event ResolutionVoteChanged(uint256 indexed taskId, address indexed arbitrator, bytes32 indexed previousProposal, bool executorWins, bytes32 resolutionHash, uint256 votes);
    event ResolutionExecuted(uint256 indexed taskId, bool executorWins, bytes32 resolutionHash);

    constructor(ITaskRegistryDisputes registry_, address[] memory arbitrators_, uint256 quorum_, address initialOwner) Ownable(initialOwner) {
        if (address(registry_) == address(0) || arbitrators_.length < 3 || quorum_ < 2 || quorum_ > arbitrators_.length) revert InvalidConfiguration();
        registry = registry_;
        quorum = quorum_;
        for (uint256 i; i < arbitrators_.length; ++i) {
            address arbitrator = arbitrators_[i];
            if (arbitrator == address(0) || isArbitrator[arbitrator]) revert InvalidConfiguration();
            isArbitrator[arbitrator] = true;
        }
    }

    function vote(uint256 taskId, bool executorWins, bytes32 resolutionHash) external {
        if (!isArbitrator[msg.sender]) revert Unauthorized();
        if (resolved[taskId]) revert AlreadyResolved();
        if (hasVoted[taskId][msg.sender]) revert AlreadyVoted();
        if (resolutionHash == bytes32(0)) revert InvalidConfiguration();
        hasVoted[taskId][msg.sender] = true;
        bytes32 proposal = keccak256(abi.encode(executorWins, resolutionHash));
        proposalByArbitrator[taskId][msg.sender] = proposal;
        uint256 votes = ++voteCount[taskId][proposal];
        emit ResolutionVote(taskId, msg.sender, executorWins, resolutionHash, votes);
        _executeIfQuorum(taskId, executorWins, resolutionHash, votes);
    }

    /// @notice Lets an arbitrator repair a split vote before resolution. The
    /// previous vote is removed atomically, so each arbitrator still has one
    /// effective vote per task at every point in time.
    function changeVote(uint256 taskId, bool executorWins, bytes32 resolutionHash) external {
        if (!isArbitrator[msg.sender]) revert Unauthorized();
        if (resolved[taskId]) revert AlreadyResolved();
        if (!hasVoted[taskId][msg.sender]) revert NoVote();
        if (resolutionHash == bytes32(0)) revert InvalidConfiguration();
        bytes32 previous = proposalByArbitrator[taskId][msg.sender];
        bytes32 proposal = keccak256(abi.encode(executorWins, resolutionHash));
        if (proposal == previous) revert AlreadyVoted();
        voteCount[taskId][previous] -= 1;
        proposalByArbitrator[taskId][msg.sender] = proposal;
        uint256 votes = ++voteCount[taskId][proposal];
        emit ResolutionVoteChanged(taskId, msg.sender, previous, executorWins, resolutionHash, votes);
        _executeIfQuorum(taskId, executorWins, resolutionHash, votes);
    }

    function _executeIfQuorum(uint256 taskId, bool executorWins, bytes32 resolutionHash, uint256 votes) private {
        if (votes < quorum) return;
        resolved[taskId] = true;
        registry.resolveRejection(taskId, executorWins, resolutionHash);
        emit ResolutionExecuted(taskId, executorWins, resolutionHash);
    }
}
