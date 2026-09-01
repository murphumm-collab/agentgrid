// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentRegistry} from "AgentRegistry.sol";
import {StakeCreditManager} from "StakeCreditManager.sol";

/// @dev Test-only sparse storage preparation. It preserves the exact production
/// last-page and Fenwick code paths without spending 65,536 registration
/// transactions merely to establish the governed gas boundary.
contract SelectionGasHarness is AgentRegistry {
    constructor(StakeCreditManager stakeManager_) AgentRegistry(stakeManager_) {}

    function prepareSparsePool(
        bytes32 poolId, address requester, uint256 candidateCount, uint16 tailCount
    ) external {
        require(
            poolId != bytes32(0) && requester != address(0) && tailCount != 0 &&
            tailCount <= MAX_SELECTION_BUILD_PAGE && candidateCount >= tailCount
        );
        registryVersion = 1;
        registryHash = keccak256("SELECTION_GAS_REGISTRY");
        uint256 start = candidateCount - tailCount;
        _seedTail(start, candidateCount, tailCount);
        _configurePool(poolId, requester, candidateCount, start);
        _setSelectionArrayLengths(poolId, start);
    }

    function _seedTail(uint256 start, uint256 candidateCount, uint16 tailCount) private {
        uint256 agentsSlot;
        bytes32 agentsData;
        assembly ("memory-safe") {
            agentsSlot := registeredAgents.slot
            sstore(agentsSlot, candidateCount)
            mstore(0, agentsSlot)
            agentsData := keccak256(0, 32)
        }
        for (uint256 i; i < tailCount; ++i) {
            uint256 index = start + i;
            address candidate = address(uint160(index + 1));
            assembly ("memory-safe") { sstore(add(agentsData, index), candidate) }
            agentPosition[candidate] = index + 1;
            agentCapabilities[candidate] = ALL_CAPABILITIES;
            agentActive[candidate] = true;
            _writeStateCheckpoint(candidate);
        }
    }

    function _configurePool(bytes32 poolId, address requester, uint256 candidateCount, uint256 start) private {
        SelectionPool storage pool = selectionPools[poolId];
        pool.requester = requester;
        pool.taskId = 1;
        pool.candidateCount = candidateCount;
        pool.cursor = start;
        pool.snapshotVersion = registryVersion;
        pool.snapshotTime = uint64(block.timestamp);
        pool.capability = CAPABILITY_TEST;
        pool.candidateSetHash = registryHash;
    }

    function _setSelectionArrayLengths(bytes32 poolId, uint256 start) private {
        uint256 mappingSlot;
        assembly ("memory-safe") { mappingSlot := selectionPoolCandidates.slot }
        _setMappedArrayLength(poolId, mappingSlot, start);
        assembly ("memory-safe") { mappingSlot := selectionPoolWeights.slot }
        _setMappedArrayLength(poolId, mappingSlot, start);
        assembly ("memory-safe") { mappingSlot := selectionPoolRemainingWeights.slot }
        _setMappedArrayLength(poolId, mappingSlot, start);
        assembly ("memory-safe") { mappingSlot := selectionPoolFenwick.slot }
        _setMappedArrayLength(poolId, mappingSlot, start + 1);
    }

    function _setMappedArrayLength(bytes32 poolId, uint256 mappingSlot, uint256 length) private {
        bytes32 lengthSlot = keccak256(abi.encode(poolId, mappingSlot));
        assembly ("memory-safe") { sstore(lengthSlot, length) }
    }
}
