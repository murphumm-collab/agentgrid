// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VerificationPanel} from "./VerificationPanel.sol";

interface IArbitrationAgentRegistry {
    function isEligible(address agent) external view returns (bool);
    function agentPosition(address agent) external view returns (uint256);
    function stakeManager() external view returns (address);
}

interface IArbitrationStakeManager {
    function stakeOf(uint256 positionId) external view returns (uint256);
    function slashAgentPosition(uint256 positionId, uint256 amount, address recipient) external;
}

/// @notice Token-staked challenge court for validator misconduct. A false
/// challenge is progressively slashed; an upheld challenge slashes the target
/// validator and credits 60% of that slash to the challenger.
contract VerificationArbitrationCourt is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MINIMUM_STAKE = 500 ether;
    uint256 public constant CHALLENGE_BOND = 50 ether;
    uint256 public constant VALIDATOR_SLASH = 100 ether;
    uint16 public constant CHALLENGER_REWARD_BPS = 6_000;
    uint16 private constant BPS = 10_000;
    uint8 public constant QUORUM = 2;
    uint256 public constant ARBITRATION_WINDOW = 3 days;

    struct Challenge {
        address challenger;
        address validator;
        bytes32 challengeHash;
        bytes32 resolutionHash;
        uint64 deadline;
        uint256 challengerStakeSnapshot;
        uint256 validatorStakeLocked;
        address[3] voters;
        uint8 voterCount;
        uint8 upholdVotes;
        uint8 rejectVotes;
        bool resolved;
    }

    IERC20 public immutable token;
    VerificationPanel public immutable panel;
    IArbitrationAgentRegistry public immutable agentRegistry;
    IArbitrationStakeManager public immutable stakeManager;
    address public immutable reserve;
    mapping(address => uint256) public stake;
    mapping(address => uint256) public lockedStake;
    mapping(address => uint8) public falseChallengeCount;
    mapping(address => bool) public isArbitrator;
    mapping(uint256 => bytes32) public activeCaseId;
    mapping(bytes32 => Challenge) public cases;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    mapping(bytes32 => mapping(bytes32 => uint8)) public upholdVotesByResolution;
    mapping(bytes32 => mapping(bytes32 => uint8)) public rejectVotesByResolution;

    error Unauthorized();
    error InvalidStake();
    error InvalidChallenge();
    error AlreadyVoted();
    event ArbitrationStakeDeposited(address indexed agent, uint256 amount, uint256 totalStake);
    event ArbitrationStakeWithdrawn(address indexed agent, uint256 amount);
    event VerificationChallengeOpened(uint256 indexed taskId, bytes32 indexed caseId, address indexed challenger, address validator, bytes32 challengeHash, uint64 deadline);
    event VerificationChallengeVote(uint256 indexed taskId, bytes32 indexed caseId, address indexed arbitrator, bool upheld, bytes32 resolutionHash);
    event VerificationChallengeResolved(uint256 indexed taskId, bytes32 indexed caseId, bool upheld, bytes32 resolutionHash, uint256 challengerSlash, uint256 validatorSlash, uint256 challengerReward);
    event VerificationChallengeExpired(uint256 indexed taskId, bytes32 indexed caseId);

    constructor(IERC20 token_, VerificationPanel panel_, IArbitrationAgentRegistry agentRegistry_, address reserve_, address[3] memory arbitrators) {
        if (address(token_) == address(0) || address(panel_) == address(0) || address(agentRegistry_) == address(0) || reserve_ == address(0)) revert Unauthorized();
        token = token_;
        panel = panel_;
        agentRegistry = agentRegistry_;
        stakeManager = IArbitrationStakeManager(agentRegistry_.stakeManager());
        reserve = reserve_;
        for (uint8 i; i < 3; ++i) {
            if (arbitrators[i] == address(0) || isArbitrator[arbitrators[i]]) revert Unauthorized();
            isArbitrator[arbitrators[i]] = true;
        }
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidStake();
        stake[msg.sender] += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit ArbitrationStakeDeposited(msg.sender, amount, stake[msg.sender]);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > stake[msg.sender] - lockedStake[msg.sender]) revert InvalidStake();
        stake[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit ArbitrationStakeWithdrawn(msg.sender, amount);
    }

    function openChallenge(uint256 taskId, address validator, bytes32 challengeHash) external {
        VerificationPanel.Panel memory current = panel.getPanel(taskId);
        bytes32 caseId = keccak256(abi.encode(block.chainid, address(this), taskId, current.workRound, current.checkpoint, current.epoch));
        if (
            validator == address(0) || validator == msg.sender || challengeHash == bytes32(0) ||
            cases[caseId].challenger != address(0) || isArbitrator[msg.sender] ||
            panel.isPanelTester(taskId, msg.sender) || !agentRegistry.isEligible(msg.sender)
        ) revert InvalidChallenge();
        // The challenger and the adjudicators must have skin in the game.  The
        // reported validator does not need a second court deposit: requiring it
        // would make an unbonded dishonest validator impossible to challenge.
        uint256 available = stake[msg.sender] - lockedStake[msg.sender];
        if (available < MINIMUM_STAKE || available < CHALLENGE_BOND) revert InvalidStake();
        lockedStake[msg.sender] += available;
        uint256 validatorAvailable = stake[validator] - lockedStake[validator];
        uint256 validatorLock = validatorAvailable < VALIDATOR_SLASH ? validatorAvailable : VALIDATOR_SLASH;
        lockedStake[validator] += validatorLock;
        uint64 deadline = uint64(block.timestamp + ARBITRATION_WINDOW);
        cases[caseId] = Challenge({
            challenger: msg.sender, validator: validator, challengeHash: challengeHash,
            resolutionHash: bytes32(0), deadline: deadline, challengerStakeSnapshot: available,
            validatorStakeLocked: validatorLock, voters: [address(0), address(0), address(0)],
            voterCount: 0, upholdVotes: 0, rejectVotes: 0, resolved: false
        });
        activeCaseId[taskId] = caseId;
        panel.challenge(taskId, validator, challengeHash);
        emit VerificationChallengeOpened(taskId, caseId, msg.sender, validator, challengeHash, deadline);
    }

    function vote(uint256 taskId, bool upheld, bytes32 resolutionHash) external {
        bytes32 caseId = activeCaseId[taskId];
        Challenge storage dispute = cases[caseId];
        if (
            !isArbitrator[msg.sender] || msg.sender == dispute.challenger || msg.sender == dispute.validator ||
            panel.isPanelTester(taskId, msg.sender) || stake[msg.sender] - lockedStake[msg.sender] < MINIMUM_STAKE
        ) revert Unauthorized();
        if (dispute.challenger == address(0) || dispute.resolved || block.timestamp > dispute.deadline || resolutionHash == bytes32(0)) revert InvalidChallenge();
        if (hasVoted[caseId][msg.sender]) revert AlreadyVoted();
        hasVoted[caseId][msg.sender] = true;
        lockedStake[msg.sender] += MINIMUM_STAKE;
        dispute.voters[dispute.voterCount++] = msg.sender;
        uint8 matchingVotes;
        if (upheld) {
            dispute.upholdVotes += 1;
            matchingVotes = ++upholdVotesByResolution[caseId][resolutionHash];
        } else {
            dispute.rejectVotes += 1;
            matchingVotes = ++rejectVotesByResolution[caseId][resolutionHash];
        }
        emit VerificationChallengeVote(taskId, caseId, msg.sender, upheld, resolutionHash);
        // A 2/3 decision means two arbitrators agree on the exact auditable
        // resolution, not merely on a boolean with mutually inconsistent proof.
        if (matchingVotes >= QUORUM) _resolve(taskId, caseId, upheld, resolutionHash);
    }

    function expireChallenge(uint256 taskId) external nonReentrant {
        bytes32 caseId = activeCaseId[taskId];
        Challenge storage dispute = cases[caseId];
        if (dispute.challenger == address(0) || dispute.resolved || block.timestamp <= dispute.deadline) revert InvalidChallenge();
        dispute.resolved = true;
        _unlockParticipants(dispute);
        panel.resolveChallenge(taskId, false, caseId, bytes32(0));
        emit VerificationChallengeExpired(taskId, caseId);
    }

    function getActiveCase(uint256 taskId) external view returns (bytes32 caseId, uint64 deadline, bool resolved) {
        caseId = activeCaseId[taskId];
        Challenge storage dispute = cases[caseId];
        deadline = dispute.deadline;
        resolved = dispute.resolved;
    }

    function _resolve(uint256 taskId, bytes32 caseId, bool upheld, bytes32 resolutionHash) private nonReentrant {
        Challenge storage dispute = cases[caseId];
        dispute.resolved = true;
        dispute.resolutionHash = resolutionHash;
        _unlockParticipants(dispute);
        uint256 challengerSlash;
        uint256 validatorSlash;
        uint256 challengerReward;
        if (upheld) {
            validatorSlash = dispute.validatorStakeLocked;
            stake[dispute.validator] -= validatorSlash;
            if (validatorSlash < VALIDATOR_SLASH) {
                uint256 positionId = agentRegistry.agentPosition(dispute.validator);
                uint256 mainStake = stakeManager.stakeOf(positionId);
                uint256 shortfall = VALIDATOR_SLASH - validatorSlash;
                uint256 mainSlash = mainStake < shortfall ? mainStake : shortfall;
                if (mainSlash != 0) {
                    stakeManager.slashAgentPosition(positionId, mainSlash, address(this));
                    validatorSlash += mainSlash;
                }
            }
            challengerReward = (validatorSlash * CHALLENGER_REWARD_BPS) / BPS;
            stake[dispute.challenger] += challengerReward;
            falseChallengeCount[dispute.challenger] = 0;
            token.safeTransfer(reserve, validatorSlash - challengerReward);
        } else {
            uint8 failures = falseChallengeCount[dispute.challenger];
            uint16 slashBps = failures == 0 ? 500 : failures == 1 ? 1_500 : 3_000;
            challengerSlash = (dispute.challengerStakeSnapshot * slashBps) / BPS;
            if (challengerSlash > stake[dispute.challenger]) challengerSlash = stake[dispute.challenger];
            stake[dispute.challenger] -= challengerSlash;
            falseChallengeCount[dispute.challenger] = failures == type(uint8).max ? failures : failures + 1;
            token.safeTransfer(reserve, challengerSlash);
        }
        panel.resolveChallenge(taskId, upheld, caseId, resolutionHash);
        emit VerificationChallengeResolved(taskId, caseId, upheld, resolutionHash, challengerSlash, validatorSlash, challengerReward);
    }

    function _unlockParticipants(Challenge storage dispute) private {
        lockedStake[dispute.challenger] -= dispute.challengerStakeSnapshot;
        lockedStake[dispute.validator] -= dispute.validatorStakeLocked;
        for (uint8 i; i < dispute.voterCount; ++i) lockedStake[dispute.voters[i]] -= MINIMUM_STAKE;
    }
}
