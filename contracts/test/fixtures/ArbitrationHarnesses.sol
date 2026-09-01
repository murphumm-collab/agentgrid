// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ABI-compatible panel used to exercise the real arbitration
/// court without redeploying the full task protocol for every penalty tier.
contract ArbitrationPanelHarness {
    enum Status { None, Commit, Reveal, Challenge, Challenged, Finalized, Voided }

    struct Panel {
        address[3] testers;
        bytes32[3] scopeHashes;
        uint16[3] criterionMasks;
        uint16[3] qualityMultipliersBps;
        uint16 requiredCriterionMask;
        uint32 epoch;
        uint32 workRound;
        uint8 checkpoint;
        uint8 executorCount;
        uint8 commitCount;
        uint8 revealCount;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 challengeDeadline;
        Status status;
    }

    address public court;
    mapping(uint256 => Panel) private panels;

    function setCourt(address court_) external { court = court_; }

    function seedChallengeable(uint256 taskId, address validator, uint32 epoch) external {
        panels[taskId].testers[0] = validator;
        panels[taskId].workRound = 1;
        panels[taskId].checkpoint = 0;
        panels[taskId].epoch = epoch;
        panels[taskId].challengeDeadline = uint64(block.timestamp + 1 days);
        panels[taskId].status = Status.Challenge;
    }

    function getPanel(uint256 taskId) external view returns (Panel memory) { return panels[taskId]; }

    function isPanelTester(uint256 taskId, address tester) external view returns (bool) {
        Panel storage panel = panels[taskId];
        return panel.testers[0] == tester || panel.testers[1] == tester || panel.testers[2] == tester;
    }

    function challenge(uint256 taskId, address tester, bytes32 challengeHash) external {
        require(msg.sender == court && challengeHash != bytes32(0), "INVALID_COURT");
        Panel storage panel = panels[taskId];
        require(panel.status == Status.Challenge && panel.testers[0] == tester, "INVALID_PANEL");
        panel.status = Status.Challenged;
    }

    function resolveChallenge(uint256 taskId, bool upheld, bytes32, bytes32) external {
        require(msg.sender == court, "INVALID_COURT");
        Panel storage panel = panels[taskId];
        require(panel.status == Status.Challenged, "INVALID_PANEL");
        panel.status = upheld ? Status.Voided : Status.Challenge;
        panel.challengeDeadline = uint64(block.timestamp);
    }
}

/// @dev Minimal registry/stake-manager ABI required by the court. Tests fund
/// the validator's court stake, so the main-position slash path is inert here.
contract ArbitrationRegistryHarness {
    mapping(address => bool) public isEligible;
    mapping(address => uint256) public agentPosition;
    mapping(uint256 => uint256) public stakeOf;

    function stakeManager() external view returns (address) { return address(this); }
    function setEligible(address agent, bool eligible) external { isEligible[agent] = eligible; }
    function slashAgentPosition(uint256 positionId, uint256 amount, address) external {
        require(stakeOf[positionId] >= amount, "INSUFFICIENT_STAKE");
        stakeOf[positionId] -= amount;
    }
}
