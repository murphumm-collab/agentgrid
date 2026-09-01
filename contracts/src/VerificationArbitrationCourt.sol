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
    function qualityOf(address agent, uint8 role) external view returns (
        uint16 scoreBps, uint32 outcomeCount, uint8 severeFaults, uint64 cooldownUntil, bool banned
    );
    function rehabilitateRole(address agent, uint8 role, bytes32 evidenceHash) external;
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

    struct RehabilitationAppeal {
        address appellant;
        uint8 role;
        bytes32 evidenceHash;
        bytes32 resolutionHash;
        uint64 deadline;
        uint256 stakeSnapshot;
        address[3] voters;
        uint8 voterCount;
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
    mapping(address => mapping(uint8 => bytes32)) public activeRehabilitationAppealId;
    mapping(address => mapping(uint8 => uint64)) public rehabilitationAppealNonce;
    mapping(address => uint8) public falseRehabilitationAppealCount;
    mapping(bytes32 => RehabilitationAppeal) public rehabilitationAppeals;

    error Unauthorized();
    error InvalidStake();
    error InvalidChallenge();
    error AlreadyVoted();
    event ArbitrationStakeDeposited(address indexed agent, uint256 amount, uint256 totalStake);
    event ArbitrationStakeWithdrawn(address indexed agent, uint256 amount);
    event VerificationChallengeOpened(
        uint256 indexed taskId, bytes32 indexed caseId, address indexed challenger,
        address validator, bytes32 challengeHash, uint64 deadline,
        uint256 challengerStakeSnapshot, uint256 validatorStakeLocked
    );
    event VerificationChallengeVote(uint256 indexed taskId, bytes32 indexed caseId, address indexed arbitrator, bool upheld, bytes32 resolutionHash);
    event VerificationChallengeResolved(
        uint256 indexed taskId, bytes32 indexed caseId, bool upheld, bytes32 resolutionHash,
        uint256 challengerSlash, uint256 validatorSlash, uint256 challengerReward,
        uint16 challengerPenaltyBps, uint8 challengerFalseChallengeCount
    );
    event VerificationChallengeExpired(uint256 indexed taskId, bytes32 indexed caseId);
    event RehabilitationAppealOpened(
        address indexed appellant, uint8 indexed role, bytes32 indexed caseId,
        bytes32 evidenceHash, uint64 deadline, uint256 stakeSnapshot
    );
    event RehabilitationAppealVote(
        address indexed appellant, uint8 indexed role, bytes32 indexed caseId,
        address arbitrator, bool upheld, bytes32 resolutionHash
    );
    event RehabilitationAppealResolved(
        address indexed appellant, uint8 indexed role, bytes32 indexed caseId,
        bool upheld, bytes32 resolutionHash, uint256 appellantSlash
    );
    event RehabilitationAppealExpired(address indexed appellant, uint8 indexed role, bytes32 indexed caseId);

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
        emit VerificationChallengeOpened(
            taskId, caseId, msg.sender, validator, challengeHash, deadline, available, validatorLock
        );
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

    function openRehabilitationAppeal(uint8 role, bytes32 evidenceHash) external {
        if ((role != 1 && role != 2 && role != 4) || evidenceHash == bytes32(0) || isArbitrator[msg.sender] || !agentRegistry.isEligible(msg.sender)) {
            revert InvalidChallenge();
        }
        (,,, uint64 cooldownUntil, bool banned) = agentRegistry.qualityOf(msg.sender, role);
        if (!banned && cooldownUntil == 0) revert InvalidChallenge();
        bytes32 previous = activeRehabilitationAppealId[msg.sender][role];
        if (previous != bytes32(0) && !rehabilitationAppeals[previous].resolved) revert InvalidChallenge();
        uint256 available = stake[msg.sender] - lockedStake[msg.sender];
        if (available < MINIMUM_STAKE) revert InvalidStake();
        lockedStake[msg.sender] += available;
        uint64 nonce = ++rehabilitationAppealNonce[msg.sender][role];
        bytes32 caseId = keccak256(abi.encode(
            block.chainid, address(this), msg.sender, role, nonce, evidenceHash, "REHABILITATION_APPEAL"
        ));
        uint64 deadline = uint64(block.timestamp + ARBITRATION_WINDOW);
        rehabilitationAppeals[caseId] = RehabilitationAppeal({
            appellant: msg.sender, role: role, evidenceHash: evidenceHash, resolutionHash: bytes32(0),
            deadline: deadline, stakeSnapshot: available, voters: [address(0), address(0), address(0)],
            voterCount: 0, resolved: false
        });
        activeRehabilitationAppealId[msg.sender][role] = caseId;
        emit RehabilitationAppealOpened(msg.sender, role, caseId, evidenceHash, deadline, available);
    }

    function voteRehabilitationAppeal(address appellant, uint8 role, bool upheld, bytes32 resolutionHash) external {
        bytes32 caseId = activeRehabilitationAppealId[appellant][role];
        RehabilitationAppeal storage appeal = rehabilitationAppeals[caseId];
        if (!isArbitrator[msg.sender] || msg.sender == appellant || stake[msg.sender] - lockedStake[msg.sender] < MINIMUM_STAKE) revert Unauthorized();
        if (appeal.appellant == address(0) || appeal.resolved || block.timestamp > appeal.deadline || resolutionHash == bytes32(0)) revert InvalidChallenge();
        if (hasVoted[caseId][msg.sender]) revert AlreadyVoted();
        hasVoted[caseId][msg.sender] = true;
        lockedStake[msg.sender] += MINIMUM_STAKE;
        appeal.voters[appeal.voterCount++] = msg.sender;
        uint8 matchingVotes = upheld
            ? ++upholdVotesByResolution[caseId][resolutionHash]
            : ++rejectVotesByResolution[caseId][resolutionHash];
        emit RehabilitationAppealVote(appellant, role, caseId, msg.sender, upheld, resolutionHash);
        if (matchingVotes >= QUORUM) _resolveRehabilitationAppeal(caseId, upheld, resolutionHash);
    }

    function expireRehabilitationAppeal(address appellant, uint8 role) external nonReentrant {
        bytes32 caseId = activeRehabilitationAppealId[appellant][role];
        RehabilitationAppeal storage appeal = rehabilitationAppeals[caseId];
        if (appeal.appellant == address(0) || appeal.resolved || block.timestamp <= appeal.deadline) revert InvalidChallenge();
        appeal.resolved = true;
        _unlockRehabilitationParticipants(appeal);
        emit RehabilitationAppealExpired(appellant, role, caseId);
    }

    function _resolve(uint256 taskId, bytes32 caseId, bool upheld, bytes32 resolutionHash) private nonReentrant {
        Challenge storage dispute = cases[caseId];
        dispute.resolved = true;
        dispute.resolutionHash = resolutionHash;
        _unlockParticipants(dispute);
        uint256 challengerSlash;
        uint256 validatorSlash;
        uint256 challengerReward;
        uint16 challengerPenaltyBps;
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
            challengerPenaltyBps = failures == 0 ? 500 : failures == 1 ? 1_500 : 3_000;
            challengerSlash = (dispute.challengerStakeSnapshot * challengerPenaltyBps) / BPS;
            if (challengerSlash > stake[dispute.challenger]) challengerSlash = stake[dispute.challenger];
            stake[dispute.challenger] -= challengerSlash;
            falseChallengeCount[dispute.challenger] = failures == type(uint8).max ? failures : failures + 1;
            token.safeTransfer(reserve, challengerSlash);
        }
        panel.resolveChallenge(taskId, upheld, caseId, resolutionHash);
        emit VerificationChallengeResolved(
            taskId, caseId, upheld, resolutionHash, challengerSlash, validatorSlash, challengerReward,
            challengerPenaltyBps, falseChallengeCount[dispute.challenger]
        );
    }

    function _unlockParticipants(Challenge storage dispute) private {
        lockedStake[dispute.challenger] -= dispute.challengerStakeSnapshot;
        lockedStake[dispute.validator] -= dispute.validatorStakeLocked;
        for (uint8 i; i < dispute.voterCount; ++i) lockedStake[dispute.voters[i]] -= MINIMUM_STAKE;
    }

    function _resolveRehabilitationAppeal(bytes32 caseId, bool upheld, bytes32 resolutionHash) private nonReentrant {
        RehabilitationAppeal storage appeal = rehabilitationAppeals[caseId];
        appeal.resolved = true;
        appeal.resolutionHash = resolutionHash;
        _unlockRehabilitationParticipants(appeal);
        uint256 appellantSlash;
        if (upheld) {
            bytes32 rehabilitationEvidence = keccak256(abi.encode(
                caseId, appeal.appellant, appeal.role, appeal.evidenceHash, resolutionHash
            ));
            agentRegistry.rehabilitateRole(appeal.appellant, appeal.role, rehabilitationEvidence);
            falseRehabilitationAppealCount[appeal.appellant] = 0;
        } else {
            uint8 failures = falseRehabilitationAppealCount[appeal.appellant];
            uint16 slashBps = failures == 0 ? 500 : failures == 1 ? 1_500 : 3_000;
            appellantSlash = (appeal.stakeSnapshot * slashBps) / BPS;
            if (appellantSlash > stake[appeal.appellant]) appellantSlash = stake[appeal.appellant];
            stake[appeal.appellant] -= appellantSlash;
            falseRehabilitationAppealCount[appeal.appellant] = failures == type(uint8).max ? failures : failures + 1;
            token.safeTransfer(reserve, appellantSlash);
        }
        emit RehabilitationAppealResolved(
            appeal.appellant, appeal.role, caseId, upheld, resolutionHash, appellantSlash
        );
    }

    function _unlockRehabilitationParticipants(RehabilitationAppeal storage appeal) private {
        lockedStake[appeal.appellant] -= appeal.stakeSnapshot;
        for (uint8 i; i < appeal.voterCount; ++i) lockedStake[appeal.voters[i]] -= MINIMUM_STAKE;
    }
}
