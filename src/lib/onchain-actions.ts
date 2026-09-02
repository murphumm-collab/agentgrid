export const onChainContractKeys = [
  "token", "stakeManager", "agentRegistry", "taskRegistry", "rewardVault",
  "verificationPanel", "verificationArbitrationCourt", "disputeResolver", "protocolEconomics",
  "competitionSlotPassRegistry",
] as const;

export type OnChainContractKey = typeof onChainContractKeys[number];
export type OnChainActionPhase = "FUNDING" | "IDENTITY" | "PUBLISHING" | "EVALUATION" | "EXECUTION" | "VERIFICATION" | "ARBITRATION" | "MAINTENANCE" | "REWARDS";

export interface OnChainActionContract {
  id: string;
  phase: OnChainActionPhase;
  role: string;
  contract: OnChainContractKey;
  signature: string;
  availability: "PRIMARY" | "COMPATIBILITY";
  authorization: string;
  effect: string;
}

export interface OnChainActionExclusion {
  contract: OnChainContractKey;
  signature: string;
  classification: "GOVERNANCE_ONLY" | "PROTOCOL_INTERNAL" | "TOKEN_TRANSFER_OUTSIDE_AGENTGRID_WORKFLOW";
  reason: string;
}

const action = (id: string, phase: OnChainActionPhase, role: string, contract: OnChainContractKey, signature: string, authorization: string, effect: string, availability: OnChainActionContract["availability"] = "PRIMARY"): OnChainActionContract => ({ id, phase, role, contract, signature, availability, authorization, effect });

export const onChainActionContracts = [
  action("approve-protocol-token", "FUNDING", "TOKEN_OWNER", "token", "approve(address,uint256)", "wallet owns the tokens; spender and amount must be checked before signing", "sets an ERC-20 allowance; it does not create stake or prove a later transfer"),
  action("request-testnet-token", "FUNDING", "TESTNET_PARTICIPANT", "token", "faucet()", "BSC Testnet faucet cooldown permits the caller", "mints test-only AGT; unavailable as a production-value source"),
  action("create-stake-position", "FUNDING", "WALLET_OWNER", "stakeManager", "createPosition(uint256)", "caller approved the StakeCreditManager and amount meets the on-chain minimum", "transfers AGT into a new wallet-owned stake position"),
  action("increase-stake-position", "FUNDING", "POSITION_OWNER", "stakeManager", "increaseStake(uint256,uint256)", "caller owns the position and approved the additional amount", "adds AGT to the existing position without changing task state"),
  action("issue-task-credit", "FUNDING", "POSITION_OWNER", "stakeManager", "issueCredit(uint256)", "position is idle, sufficiently funded and not withdrawing", "issues one expiring Task Credit for the position"),
  action("request-stake-withdrawal", "FUNDING", "POSITION_OWNER", "stakeManager", "requestWithdrawal(uint256)", "position has no active task", "starts the withdrawal delay and removes the position from Agent selection"),
  action("execute-stake-withdrawal", "FUNDING", "POSITION_OWNER", "stakeManager", "executeWithdrawal(uint256)", "the withdrawal delay has elapsed", "returns the remaining position stake and closes the withdrawal request"),

  action("register-agent-capabilities", "IDENTITY", "AGENT_WALLET", "agentRegistry", "registerWithCapabilities(uint256,uint8)", "pure executors declare capability 1 with position 0; every evaluator, validator or combined capability requires a caller-owned eligible non-withdrawing stake position", "registers or updates the wallet-bound Agent identity and role capabilities"),
  action("register-agent-legacy", "IDENTITY", "AGENT_WALLET", "agentRegistry", "register(uint256)", "compatibility registration with the base execute/test capability set", "legacy alias; new integrations should declare exact capabilities", "COMPATIBILITY"),
  action("set-agent-active", "IDENTITY", "AGENT_WALLET", "agentRegistry", "setActive(bool)", "caller is the registered Agent wallet; zero-stake pure executors may reactivate, while every staked role still requires eligible stake", "changes on-chain role eligibility and advances the registry snapshot"),
  action("build-selection-pool-page", "IDENTITY", "ANYONE", "agentRegistry", "buildSelectionPool(bytes32,uint16)", "the protocol-created pool is incomplete and the requested sequential page contains at most 64 candidates", "permissionlessly appends the next frozen all-candidate page; no entropy exists until the full prefix is complete"),
  action("reschedule-expired-selection-entropy", "IDENTITY", "ANYONE", "agentRegistry", "rescheduleSelectionPool(bytes32)", "the completed pool has no selected member and its prior blockhash is objectively unavailable", "permissionlessly schedules new future entropy without changing or rebuilding the frozen pool"),

  action("commit-task-source", "PUBLISHING", "PUBLISHER", "protocolEconomics", "commitNextTaskSource(bytes32)", "source ID is configured or the publisher accepts DAO fallback", "commits source attribution consumed by the publisher's next task only"),
  action("create-task", "PUBLISHING", "PUBLISHER", "taskRegistry", "createTaskWithModeAndTesterCapabilities(uint256,bytes32,uint256,uint8,uint8,uint8)", "caller owns a live Task Credit and the spec/reward/executor/mode/capability commitment is frozen", "creates a private evaluation-stage task, freezes source attribution and consumes the evaluation lifecycle charge"),
  action("create-task-legacy", "PUBLISHING", "PUBLISHER", "taskRegistry", "createTaskWithMode(uint256,bytes32,uint256,uint8,uint8)", "compatibility path using the base tester capability", "legacy alias; new integrations must commit exact tester capabilities", "COMPATIBILITY"),
  action("review-task-result", "PUBLISHING", "PUBLISHER", "taskRegistry", "review(uint256,bool,bytes32)", "caller is the task publisher and the task is in UserReview", "accepts into maintenance and creates rewards, or opens a structured rejection"),

  action("finalize-evaluator-draw", "EVALUATION", "ANYONE", "taskRegistry", "finalizeEvaluationPanel(uint256)", "the committed future block is available and within its 256-block proof window", "freezes three eligible evaluators from the request-time registry snapshot"),
  action("submit-task-evaluation", "EVALUATION", "ASSIGNED_EVALUATOR", "taskRegistry", "submitEvaluation(uint256,bytes32,uint16,uint32,uint16,uint256,bool,bytes32)", "caller is assigned, within the deadline, and submits the hash of the matching signed report", "records one evaluator vote and bounded recommendation"),
  action("finalize-task-evaluation", "EVALUATION", "ANYONE", "taskRegistry", "finalizeTaskEvaluation(uint256)", "the three-member panel is frozen and the terminal quorum condition is met", "publishes an approved task or rejects it and releases the publisher position"),
  action("expire-task-evaluation", "EVALUATION", "ANYONE", "taskRegistry", "expireTaskEvaluation(uint256)", "the evaluation deadline elapsed without a terminal result", "expires the private task and releases its publisher position"),
  action("settle-evaluator-quality", "EVALUATION", "ANYONE", "verificationPanel", "settleEvaluationOutcomes(uint256)", "the canonical evaluation reached a terminal state and has not been settled", "records one-shot objective evaluator quality outcomes"),

  action("claim-executor-slot", "EXECUTION", "ELIGIBLE_EXECUTOR", "taskRegistry", "claimTask(uint256)", "caller has a wallet-bound active execution identity with no cooldown/ban (AGT stake is not required); task is open/claimed/correction, a slot is free and caller has no conflict", "adds the caller to the frozen execution team or competition set"),
  action("close-underfilled-team", "EXECUTION", "LEAD_OR_COORDINATOR", "taskRegistry", "closeTeam(uint256)", "formation window elapsed and at least one executor is present", "closes the team without changing the committed completion definition"),
  action("evict-inactive-executor", "EXECUTION", "ANYONE", "taskRegistry", "evictInactiveExecutor(uint256,address)", "the assigned executor missed the objective on-chain inactivity window without contributing", "permissionlessly removes the inactive member and reopens formation for the same work round"),
  action("submit-executor-contribution", "EXECUTION", "ASSIGNED_EXECUTOR", "taskRegistry", "submitContribution(uint256,bytes32)", "caller is in the current team and the contribution hash is non-zero", "commits or replaces the caller's contribution for the current work round"),
  action("submit-assembled-work", "EXECUTION", "COLLABORATION_LEAD", "taskRegistry", "submitWork(uint256,bytes32)", "team is closed and every current member committed a contribution", "commits the assembled collaboration artifact and requests later validation"),

  action("request-validator-draw", "VERIFICATION", "ANYONE", "taskRegistry", "requestTester(uint256)", "task is submitted and no valid draw is already pending", "permissionlessly commits the eligible validator candidate set and a future selection block; the caller cannot choose a validator"),
  action("finalize-validator-draw", "VERIFICATION", "ANYONE", "taskRegistry", "finalizeTester(uint256)", "the future block is available within 256 blocks and three conflict-free validators remain eligible", "permissionlessly starts the deterministic three-member isolated-shard panel epoch"),
  action("commit-validator-shard", "VERIFICATION", "ASSIGNED_PANEL_MEMBER", "verificationPanel", "commitShard(uint256,bytes32)", "caller owns one frozen shard and the commit window is open", "conceals the shard result until all three commitments exist"),
  action("reveal-validator-shard", "VERIFICATION", "ASSIGNED_PANEL_MEMBER", "verificationPanel", "revealShard(uint256,uint16,address,bytes32,bytes32,uint16[],bytes32)", "all commits exist, caller's preimage matches and only its criterion shard is reported", "reveals one ordered shard report without granting cross-shard access"),
  action("finalize-verification-panel", "VERIFICATION", "ANYONE", "verificationPanel", "finalize(uint256)", "the 24-hour challenge window elapsed without an active challenge", "aggregates two votes per criterion, freezes weights and advances the canonical task"),
  action("expire-verification-phase", "VERIFICATION", "ANYONE", "verificationPanel", "expire(uint256)", "the commit or reveal deadline elapsed", "voids the stalled epoch and enters a fresh correction work round"),

  action("deposit-arbitration-stake", "ARBITRATION", "CHALLENGER_OR_ARBITRATOR", "verificationArbitrationCourt", "deposit(uint256)", "caller approved the Court token transfer", "adds slashable Court stake; it grants no vote unless the wallet is a configured arbitrator"),
  action("withdraw-unlocked-arbitration-stake", "ARBITRATION", "COURT_STAKER", "verificationArbitrationCourt", "withdraw(uint256)", "requested amount does not exceed unlocked Court stake", "returns only stake not frozen by a challenge or rehabilitation case"),
  action("open-verification-challenge", "ARBITRATION", "ELIGIBLE_CHALLENGER", "verificationArbitrationCourt", "openChallenge(uint256,address,bytes32)", "caller is eligible, independent of panel/arbitrators and has at least 500 AGT available", "locks the challenger's snapshot and opens one epoch-bound validator challenge"),
  action("vote-verification-challenge", "ARBITRATION", "CONFIGURED_ARBITRATOR", "verificationArbitrationCourt", "vote(uint256,bool,bytes32)", "caller is independent, has 500 AGT unlocked and has not voted in the case", "locks arbitrator stake and resolves only after two exact matching resolution hashes"),
  action("expire-verification-challenge", "ARBITRATION", "ANYONE", "verificationArbitrationCourt", "expireChallenge(uint256)", "three-day arbitration deadline elapsed without quorum", "unlocks participants and returns the panel to its challenge-finalization path without a verdict"),
  action("open-role-rehabilitation", "ARBITRATION", "COOLED_OR_BANNED_AGENT", "verificationArbitrationCourt", "openRehabilitationAppeal(uint8,bytes32)", "role is cooled/banned and caller has at least 500 AGT available", "locks the Agent's Court stake and opens an evidence-bound rehabilitation appeal"),
  action("vote-role-rehabilitation", "ARBITRATION", "CONFIGURED_ARBITRATOR", "verificationArbitrationCourt", "voteRehabilitationAppeal(address,uint8,bool,bytes32)", "caller is independent, funded and has not voted in this appeal", "requires two exact matching hashes to restore the quality floor or apply the penalty tier"),
  action("expire-role-rehabilitation", "ARBITRATION", "ANYONE", "verificationArbitrationCourt", "expireRehabilitationAppeal(address,uint8)", "three-day appeal deadline elapsed without quorum", "unlocks participants without restoring the role or adding a penalty"),
  action("vote-rejection-dispute", "ARBITRATION", "REJECTION_ARBITRATOR", "disputeResolver", "vote(uint256,bool,bytes32)", "caller is configured and has not voted on the unresolved rejection", "records one exact proposal and executes only at configured quorum"),
  action("change-rejection-vote", "ARBITRATION", "REJECTION_ARBITRATOR", "disputeResolver", "changeVote(uint256,bool,bytes32)", "caller previously voted and the dispute is unresolved", "atomically replaces the caller's proposal without counting two votes"),
  action("respond-to-rejection", "ARBITRATION", "SELECTED_EXECUTOR", "taskRegistry", "respondToRejection(uint256,bytes32)", "caller is the lead/winner and the response window remains open", "records one immutable structured rejection response for arbitration"),

  action("request-maintenance-panel", "MAINTENANCE", "ANYONE", "taskRegistry", "requestMaintenancePanel(uint256,uint8)", "checkpoint is due, ordered and not already proven", "permissionlessly starts a fresh current-registry validator draw; it never reuses the acceptance panel"),

  action("claim-reward-checkpoint", "REWARDS", "RECIPIENT", "rewardVault", "claim(uint256,uint8)", "checkpoint is approved, due and caller has an unpaid allocation", "pays only the caller's frozen executor or validator allocation"),
  action("claim-source-vesting", "REWARDS", "VESTING_RECIPIENT", "protocolEconomics", "claimVesting(bytes32)", "caller is the vesting recipient and the governed unlock time elapsed", "pays one immutable DAO/source vesting exactly once"),
] as const satisfies readonly OnChainActionContract[];

const excluded = (contract: OnChainContractKey, signature: string, classification: OnChainActionExclusion["classification"], reason: string): OnChainActionExclusion => ({ contract, signature, classification, reason });
const governance = (contract: OnChainContractKey, signature: string) => excluded(contract, signature, "GOVERNANCE_ONLY", "Requires contract owner/bootstrap governance and is never a participant workflow action.");
const internal = (contract: OnChainContractKey, signature: string) => excluded(contract, signature, "PROTOCOL_INTERNAL", "Authorized only for another configured protocol contract; wallets must use the originating lifecycle action.");

export const onChainActionExclusions = [
  governance("token", "mintRewardReserve(address,uint256)"),
  governance("token", "renounceOwnership()"),
  governance("token", "transferOwnership(address)"),
  excluded("token", "transfer(address,uint256)", "TOKEN_TRANSFER_OUTSIDE_AGENTGRID_WORKFLOW", "Generic ERC-20 transfer; it does not create protocol stake, credit, payment attribution or task evidence."),
  excluded("token", "transferFrom(address,address,uint256)", "TOKEN_TRANSFER_OUTSIDE_AGENTGRID_WORKFLOW", "Generic allowance transfer; protocol funding must use the named stake or Court entrypoint."),

  internal("stakeManager", "chargeEvaluationFee(uint256,uint256,uint256,address)"),
  internal("stakeManager", "chargeLifecycleFee(uint256,uint256,uint8,uint256)"),
  internal("stakeManager", "chargePublicationFee(uint256,uint256,uint256,address)"),
  internal("stakeManager", "consumeCredit(uint256,uint256,address)"),
  internal("stakeManager", "releasePosition(uint256,uint256)"),
  internal("stakeManager", "slashAgentPosition(uint256,uint256,address)"),
  internal("stakeManager", "slashPosition(uint256,uint256,uint256,address)"),
  governance("stakeManager", "renounceOwnership()"),
  governance("stakeManager", "setProtocolEconomics(address)"),
  governance("stakeManager", "setQualitySlasher(address)"),
  governance("stakeManager", "setTaskRegistry(address)"),
  governance("stakeManager", "transferOwnership(address)"),

  internal("agentRegistry", "recordOutcome(address,uint8,bytes32,bytes32,bool,bool,bytes32)"),
  internal("agentRegistry", "recordTaskOutcome(address,uint8,uint256,address,uint256,bytes32,bytes32,bool,bool,bytes32)"),
  internal("agentRegistry", "rehabilitateRole(address,uint8,bytes32)"),
  governance("agentRegistry", "setOutcomeReporter(address,uint8)"),
  governance("agentRegistry", "setSelectionRequester(address)"),
  internal("agentRegistry", "startSelectionPool(bytes32,uint256,uint8,bool)"),
  internal("agentRegistry", "drawSelectionPanel(bytes32,uint8)"),

  internal("taskRegistry", "finalizeVerificationPanel(uint256,uint32,uint8,bool,address,bytes32,bytes32,uint16[],address[3],uint16[3])"),
  internal("taskRegistry", "resolveRejection(uint256,bool,bytes32)"),
  governance("taskRegistry", "renounceOwnership()"),
  governance("taskRegistry", "setDisputeResolver(address)"),
  governance("taskRegistry", "setProtocolEconomics(address)"),
  governance("taskRegistry", "setCompetitionSlotPassRegistry(address)"),
  governance("taskRegistry", "setVerificationPanel(address)"),
  governance("taskRegistry", "transferOwnership(address)"),

  internal("rewardVault", "approveCheckpoint(uint256,uint8)"),
  internal("rewardVault", "createGrant(uint256,address[],uint16[],address,bytes32,uint256,uint256)"),
  internal("rewardVault", "registerEvaluationFee(uint256,uint256)"),
  internal("rewardVault", "setTesterPanel(uint256,uint8,address[3],uint16[3])"),
  internal("rewardVault", "settleEvaluationFee(uint256,address[])"),
  internal("rewardVault", "updateFutureParticipants(uint256,uint8,address[],uint16[],address)"),
  governance("rewardVault", "renounceOwnership()"),
  governance("rewardVault", "setProtocolEconomics(address)"),
  governance("rewardVault", "setTaskRegistry(address)"),
  governance("rewardVault", "setVerificationPanel(address)"),
  governance("rewardVault", "transferOwnership(address)"),

  internal("verificationPanel", "challenge(uint256,address,bytes32)"),
  internal("verificationPanel", "resolveChallenge(uint256,bool,bytes32,bytes32)"),
  internal("verificationPanel", "startPanel(uint256,uint32,uint8,uint8,address[3],uint16,uint16[3],bytes32[3])"),
  governance("verificationPanel", "setArbitrationCourt(address)"),

  governance("disputeResolver", "renounceOwnership()"),
  governance("disputeResolver", "transferOwnership(address)"),

  internal("protocolEconomics", "freezeTaskSource(uint256,address)"),
  internal("protocolEconomics", "routeLifecycleCharge(uint256,uint8,uint256,uint256)"),
  internal("protocolEconomics", "routeTaskReward(uint256,uint256,uint256)"),
  governance("protocolEconomics", "configureProtocol(address,address)"),
  governance("protocolEconomics", "configureSource(bytes32,address,bool)"),
  governance("protocolEconomics", "renounceOwnership()"),
  governance("protocolEconomics", "transferOwnership(address)"),

  internal("competitionSlotPassRegistry", "registerAuthorization(tuple,bytes)"),
  internal("competitionSlotPassRegistry", "consume(bytes32,address,bytes32,bytes32,bytes32,uint256,uint8,uint8)"),
  internal("competitionSlotPassRegistry", "consumeFor(address,bytes32,uint8)"),
  governance("competitionSlotPassRegistry", "renounceOwnership()"),
  governance("competitionSlotPassRegistry", "setIssuer(address)"),
  governance("competitionSlotPassRegistry", "transferOwnership(address)"),
] as const satisfies readonly OnChainActionExclusion[];
