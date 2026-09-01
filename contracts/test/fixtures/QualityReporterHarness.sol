// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentQualityHarnessTarget {
    function recordOutcome(
        address agent, uint8 role, bytes32 contextId, bytes32 outcomeType,
        bool success, bool severe, bytes32 evidenceHash
    ) external;
    function recordTaskOutcome(
        address agent, uint8 role, uint256 taskId, address publisher, uint256 taskReward,
        bytes32 contextId, bytes32 outcomeType, bool success, bool severe, bytes32 evidenceHash
    ) external;
    function rehabilitateRole(address agent, uint8 role, bytes32 evidenceHash) external;
}

/// @dev Test-only protocol-contract caller. It is intentionally outside
/// contracts/src so it can never enter a deployment artifact set.
contract QualityReporterHarness {
    IAgentQualityHarnessTarget public immutable registry;

    constructor(IAgentQualityHarnessTarget registry_) { registry = registry_; }

    function record(
        address agent, uint8 role, bytes32 contextId, bytes32 outcomeType,
        bool success, bool severe, bytes32 evidenceHash
    ) external {
        registry.recordOutcome(agent, role, contextId, outcomeType, success, severe, evidenceHash);
    }

    function recordTask(
        address agent, uint8 role, uint256 taskId, address publisher, uint256 taskReward,
        bytes32 contextId, bytes32 outcomeType, bool success, bool severe, bytes32 evidenceHash
    ) external {
        registry.recordTaskOutcome(
            agent, role, taskId, publisher, taskReward, contextId, outcomeType, success, severe, evidenceHash
        );
    }

    function rehabilitate(address agent, uint8 role, bytes32 evidenceHash) external {
        registry.rehabilitateRole(agent, role, evidenceHash);
    }
}
