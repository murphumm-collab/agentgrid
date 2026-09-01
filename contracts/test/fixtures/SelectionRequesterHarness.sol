// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISelectionRegistryHarness {
    function startSelectionPool(bytes32 poolId, uint256 taskId, uint8 capability, bool evaluatorPanel) external;
    function drawSelectionPool(bytes32 poolId, uint8 maxPrunes) external returns (address);
}

contract SelectionRequesterHarness {
    ISelectionRegistryHarness public immutable registry;
    mapping(uint256 => mapping(address => mapping(bool => bool))) public conflicts;

    constructor(ISelectionRegistryHarness registry_) {
        registry = registry_;
    }

    function setConflict(uint256 taskId, address candidate, bool evaluatorPanel, bool conflict) external {
        conflicts[taskId][candidate][evaluatorPanel] = conflict;
    }

    function isAgentSelectionConflict(uint256 taskId, address candidate, bool evaluatorPanel) external view returns (bool) {
        return conflicts[taskId][candidate][evaluatorPanel];
    }

    function start(bytes32 poolId, uint256 taskId, uint8 capability, bool evaluatorPanel) external {
        registry.startSelectionPool(poolId, taskId, capability, evaluatorPanel);
    }

    function draw(bytes32 poolId, uint8 maxPrunes) external returns (address) {
        return registry.drawSelectionPool(poolId, maxPrunes);
    }
}
