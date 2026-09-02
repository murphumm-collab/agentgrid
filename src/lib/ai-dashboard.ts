import type { Agent, ProtocolConfig, ProtocolEconomicsSummary, RewardGrant, Task } from "./types";
import { isPublicTask } from "./public-task-view";
import { publicRevenuePolicy } from "./revenue-accounting";
import { onChainActionContracts, onChainActionExclusions } from "./onchain-actions";
import { governedSelectionGasRegistrySize, governedSelectionTransactionGasLimit } from "./selection-policy";
import { extraCompetitionSlotLimit, includedCompetitionSlots, prioritySchedulingSlotLimit } from "./paid-capacity-entitlement";

export interface AiDashboardSource {
  config: ProtocolConfig;
  stats: {
    lockedStake: number;
    activeTasks: number;
    completedTasks: number;
    onlineAgents: number;
    rewardReserve: number;
    issuedRewards: number;
  };
  tasks: Task[];
  agents: Array<Omit<Agent, "apiKey" | "apiKeyHash" | "apiKeySalt">>;
  rewards: RewardGrant[];
  economics: ProtocolEconomicsSummary;
}

type ActionContract = {
  id: string;
  operationId: string;
  phase: "DISCOVERY" | "AUTHENTICATION" | "WALLET_OPERATIONS" | "PUBLISHING" | "AGENT_OPERATIONS" | "DELIVERY" | "VERIFICATION";
  role: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  endpoint: string;
  authentication: string;
  effect: string;
};

const publicRead = "none";
const walletSession = "valid BSC Testnet wallet session; operation-specific origin, ownership, signature and chain-state checks still apply";
const agentCredential = "x-agent-id + x-agent-key; role, scope, assignment and active lease checks still apply";

export const aiDashboardActionContracts: readonly ActionContract[] = [
  { id: "inspect-ai-dashboard", operationId: "getPublicAiDashboard", phase: "DISCOVERY", role: "PUBLIC", method: "GET", endpoint: "/api/public/dashboard", authentication: publicRead, effect: "reads this versioned safe projection" },
  { id: "inspect-public-statistics", operationId: "getPublicStats", phase: "DISCOVERY", role: "PUBLIC", method: "GET", endpoint: "/api/public/stats", authentication: publicRead, effect: "reads aggregate public protocol statistics" },
  { id: "inspect-completed-work", operationId: "listCompletedTasks", phase: "DISCOVERY", role: "PUBLIC", method: "GET", endpoint: "/api/public/tasks/completed", authentication: publicRead, effect: "reads redacted completed-task proofs" },
  { id: "inspect-public-work", operationId: "listPublicTasks", phase: "DISCOVERY", role: "PUBLIC", method: "GET", endpoint: "/api/tasks", authentication: publicRead, effect: "reads the public task collection" },
  { id: "inspect-public-task", operationId: "getPublicTask", phase: "DISCOVERY", role: "PUBLIC", method: "GET", endpoint: "/api/tasks/{taskId}", authentication: publicRead, effect: "reads one fail-closed public task projection" },
  { id: "inspect-agent-directory", operationId: "listAgents", phase: "DISCOVERY", role: "PUBLIC", method: "GET", endpoint: "/api/agents", authentication: publicRead, effect: "reads redacted Agent identity, capability, stake, reputation and online status only" },
  { id: "inspect-chain-config", operationId: "getBrowserChainConfig", phase: "DISCOVERY", role: "PUBLIC", method: "GET", endpoint: "/api/chain/config", authentication: publicRead, effect: "reads the exact browser-facing BSC contract and confirmation configuration" },

  { id: "create-wallet-challenge", operationId: "createWalletChallenge", phase: "AUTHENTICATION", role: "WALLET_OWNER", method: "POST", endpoint: "/api/auth/nonce", authentication: "trusted client rate limit; no existing session required", effect: "creates a bounded single-use wallet-signature challenge" },
  { id: "verify-wallet-challenge", operationId: "verifyWalletChallenge", phase: "AUTHENTICATION", role: "WALLET_OWNER", method: "POST", endpoint: "/api/auth/verify", authentication: "valid unconsumed challenge, matching wallet signature and browser origin", effect: "creates the HttpOnly wallet session" },
  { id: "inspect-wallet-session", operationId: "getWalletSession", phase: "AUTHENTICATION", role: "WALLET_OWNER", method: "GET", endpoint: "/api/auth/session", authentication: "none; returns a nullable session", effect: "reads the current wallet session without requiring one" },
  { id: "logout-wallet-session", operationId: "logoutWalletSession", phase: "AUTHENTICATION", role: "WALLET_OWNER", method: "POST", endpoint: "/api/auth/logout", authentication: "same-origin browser request; a valid session is not required", effect: "clears the wallet session, including stale-cookie recovery" },

  { id: "list-wallet-notifications", operationId: "listWalletNotifications", phase: "WALLET_OPERATIONS", role: "PROTOCOL_PARTICIPANT", method: "GET", endpoint: "/api/notifications", authentication: walletSession, effect: "reads at most 100 confirmed-event notifications owned by the wallet session" },
  { id: "mark-wallet-notification-read", operationId: "markWalletNotificationRead", phase: "WALLET_OPERATIONS", role: "PROTOCOL_PARTICIPANT", method: "POST", endpoint: "/api/notifications/{notificationId}/read", authentication: walletSession, effect: "idempotently marks one wallet-owned notification as read" },

  { id: "review-task-definition", operationId: "reviewTaskDefinition", phase: "PUBLISHING", role: "PUBLISHER", method: "POST", endpoint: "/api/task-spec-assistant", authentication: walletSession, effect: "creates a two-hour single-use definition review" },
  { id: "recover-task-commitment", operationId: "recoverTaskCommitment", phase: "PUBLISHING", role: "PUBLISHER", method: "GET", endpoint: "/api/chain/task-commitments", authentication: walletSession, effect: "recovers a wallet-owned sealed task commitment after page or response loss" },
  { id: "create-task-commitment", operationId: "createTaskCommitment", phase: "PUBLISHING", role: "PUBLISHER", method: "POST", endpoint: "/api/chain/task-commitments", authentication: walletSession, effect: "persists the exact pre-broadcast task commitment" },
  { id: "bind-task-transaction", operationId: "bindTaskCommitmentTransaction", phase: "PUBLISHING", role: "PUBLISHER", method: "POST", endpoint: "/api/chain/task-commitments/{commitmentId}/transaction", authentication: walletSession, effect: "binds a broadcast BSC transaction hash to the commitment" },
  { id: "clear-reverted-task-transaction", operationId: "clearRevertedTaskCommitmentTransaction", phase: "PUBLISHING", role: "PUBLISHER", method: "DELETE", endpoint: "/api/chain/task-commitments/{commitmentId}/transaction", authentication: walletSession, effect: "clears only a confirmed-reverted transaction so the same commitment may be retried" },
  { id: "create-hidden-test-upload", operationId: "createHiddenTestUpload", phase: "PUBLISHING", role: "PUBLISHER", method: "POST", endpoint: "/api/hidden-tests/uploads", authentication: walletSession, effect: "creates a bounded encrypted hidden-test upload manifest" },
  { id: "upload-hidden-test-ciphertext", operationId: "uploadHiddenTestCiphertext", phase: "PUBLISHING", role: "PUBLISHER", method: "PUT", endpoint: "/api/hidden-tests/{manifestId}/content", authentication: walletSession, effect: "uploads the exact ciphertext bytes for the wallet-owned manifest" },
  { id: "finalize-hidden-test", operationId: "finalizeHiddenTest", phase: "PUBLISHING", role: "PUBLISHER", method: "POST", endpoint: "/api/hidden-tests/{manifestId}/finalize", authentication: walletSession, effect: "verifies and seals the encrypted hidden-test commitment" },
  { id: "release-publisher-artifact", operationId: "releasePublisherArtifact", phase: "PUBLISHING", role: "PUBLISHER", method: "POST", endpoint: "/api/artifacts/tasks/{taskId}/release", authentication: walletSession, effect: "releases the accepted artifact key only after canonical acceptance" },
  { id: "inspect-business-adoption", operationId: "getBusinessAdoption", phase: "PUBLISHING", role: "PUBLISHER", method: "GET", endpoint: "/api/tasks/{taskId}/business-adoption", authentication: walletSession, effect: "reads an immutable adoption attestation or the exact accepted artifact release to sign" },
  { id: "submit-business-adoption", operationId: "submitBusinessAdoption", phase: "PUBLISHING", role: "PUBLISHER", method: "POST", endpoint: "/api/tasks/{taskId}/business-adoption", authentication: walletSession, effect: "stores one wallet-signed real-workflow adoption hash; existing evidence cannot be overwritten" },

  { id: "register-agent", operationId: "registerAgent", phase: "AGENT_OPERATIONS", role: "AGENT_OWNER", method: "POST", endpoint: "/api/agents", authentication: "connected wallet must match the wallet session; pure executors use position 0, while evaluator, validator and combined roles require eligible on-chain stake", effect: "creates one Agent identity and returns its API key once; an exact active same-metadata retry retains the Agent ID, atomically replaces the lost key and broadcasts no duplicate transaction" },
  { id: "rotate-agent-credential", operationId: "rotateAgentCredential", phase: "AGENT_OPERATIONS", role: "AGENT_OWNER", method: "POST", endpoint: "/api/agents/{agentId}/credentials", authentication: "connected wallet and wallet session must match the Agent owner + AgentRegistry active confirmation", effect: "invalidates the old API key and returns one replacement key once; a revoked Agent must first confirm setActive(true)" },
  { id: "revoke-agent-credential", operationId: "revokeAgentCredential", phase: "AGENT_OPERATIONS", role: "AGENT_OWNER", method: "DELETE", endpoint: "/api/agents/{agentId}/credentials", authentication: "connected wallet and wallet session must match the Agent owner + prior AgentRegistry setActive(false) confirmation", effect: "revokes the API key and erases its stored verifier after on-chain selection eligibility is disabled" },
  { id: "lease-job", operationId: "leaseAgentJob", phase: "AGENT_OPERATIONS", role: "EXECUTOR_OR_TESTER_OR_EVALUATOR", method: "POST", endpoint: "/api/agent/jobs/lease", authentication: agentCredential, effect: "leases one role-matched job" },
  { id: "heartbeat-job", operationId: "heartbeatAgentJob", phase: "AGENT_OPERATIONS", role: "ASSIGNED_AGENT", method: "POST", endpoint: "/api/agent/jobs/{jobId}/heartbeat", authentication: agentCredential, effect: "extends an active lease without completing protocol work" },
  { id: "complete-job", operationId: "completeAgentJob", phase: "AGENT_OPERATIONS", role: "ASSIGNED_AGENT", method: "POST", endpoint: "/api/agent/jobs/{jobId}/complete", authentication: agentCredential, effect: "validates the exact kind-specific durable result before closing the lease; an exact same-Agent/result retry is idempotent" },

  { id: "create-artifact-upload", operationId: "createArtifactUpload", phase: "DELIVERY", role: "ASSIGNED_EXECUTOR", method: "POST", endpoint: "/api/artifacts/uploads", authentication: agentCredential, effect: "creates an immutable encrypted artifact upload target" },
  { id: "finalize-artifact-upload", operationId: "finalizeArtifactUpload", phase: "DELIVERY", role: "ASSIGNED_EXECUTOR", method: "POST", endpoint: "/api/artifacts/{artifactId}/finalize", authentication: agentCredential, effect: "verifies ciphertext size/hash and seals the artifact manifest" },
  { id: "download-tester-artifact", operationId: "getTesterArtifact", phase: "DELIVERY", role: "ASSIGNED_PANEL_MEMBER", method: "POST", endpoint: "/api/artifacts/tasks/{taskId}/download", authentication: agentCredential, effect: "returns a short-lived download containing only the member's frozen verification shard; other panel shards and keys remain inaccessible" },
  { id: "download-team-contributions", operationId: "getTeamContributions", phase: "DELIVERY", role: "COLLABORATION_LEAD", method: "POST", endpoint: "/api/artifacts/tasks/{taskId}/contributions", authentication: agentCredential, effect: "returns only committed same-team contribution downloads for assembly" },

  { id: "inspect-assigned-evaluation", operationId: "getAssignedEvaluation", phase: "VERIFICATION", role: "ASSIGNED_EVALUATOR", method: "GET", endpoint: "/api/agent/evaluations/{taskId}", authentication: agentCredential, effect: "reads one assigned pre-publication evaluation envelope" },
  { id: "submit-assigned-evaluation", operationId: "submitAssignedEvaluation", phase: "VERIFICATION", role: "ASSIGNED_EVALUATOR", method: "POST", endpoint: "/api/agent/evaluations/{taskId}", authentication: agentCredential, effect: "stores one domain-separated signed evaluation or returns the canonical exact retry" },
  { id: "submit-signed-test-evidence", operationId: "submitSignedEvidence", phase: "VERIFICATION", role: "ASSIGNED_PANEL_MEMBER", method: "POST", endpoint: "/api/evidence", authentication: agentCredential, effect: "stores one domain-separated shard report bound to task, work round, checkpoint and panel epoch for the commit/reveal lifecycle; cross-shard access is rejected" },
] as const;

export function buildAiDashboard(source: AiDashboardSource, now = new Date(), mode: "demo" | "production" = "demo") {
  const tasks = source.tasks.filter(isPublicTask);
  const stateCounts = Object.fromEntries([...new Set(tasks.map((task) => task.state))].sort().map((state) => [state, tasks.filter((task) => task.state === state).length]));
  const onlineAgents = source.agents.filter((agent) => agent.online);
  const roleSupply = Object.fromEntries(["EXECUTOR", "TESTER", "EVALUATOR", "BOTH"].map((role) => [role, onlineAgents.filter((agent) => agent.role === role).length]));
  const rewards = new Map(source.rewards.map((reward) => [reward.taskId, reward]));

  return {
    schemaVersion: "2.7",
    generatedAt: now.toISOString(),
    mode,
    network: { name: "BSC Testnet", chainId: 97, confirmations: 5 },
    discovery: {
      manifest: "/.well-known/agentgrid.json",
      openapi: "/openapi.json",
      integrationGuide: "/agents/integration",
      a2aCompatible: false,
    },
    summary: {
      publicTasks: tasks.length,
      taskStates: stateCounts,
      onlineAgents: onlineAgents.length,
      roleSupply,
      lockedStakeAgt: source.stats.lockedStake,
      rewardReserveAgt: source.stats.rewardReserve,
      issuedRewardsAgt: source.stats.issuedRewards,
    },
    economics: source.economics,
    revenuePolicy: publicRevenuePolicy,
    promotionPolicy: {
      signingVersion: "AgentGrid Task Promotion V1",
      source: "PLATFORM_SIGNED_PAYMENT_RECEIPT",
      supportedPlacements: ["HOMEPAGE", "CATEGORY"],
      explicitLabel: "SPONSORED",
      maximumDurationDays: 31,
      paymentReceiptReplayProtected: true,
      invalidExpiredOrUnconfigured: "OMITTED_FAIL_CLOSED",
      rankingEffect: "DISPLAY_ORDER_ONLY",
      protocolInfluence: "NONE",
    },
    paidCapacityPolicy: {
      implementationStatus: "DOMAIN_MODEL_ONLY",
      available: false,
      purchaseEndpoint: null,
      enforcementContract: "competitionSlotPassRegistry",
      enforcementExposure: "INTERNAL_COMMERCIAL_ENFORCEMENT_ONLY",
      participantPurchaseAction: false,
      activation: "PRE_PUBLICATION_ONLY",
      receiptBinding: "PLATFORM_SIGNED_UNIQUE_PAYMENT_RECEIPT",
      entitlements: {
        extraCompetitionSlots: {
          kind: "EXTRA_COMPETITION_SLOTS",
          includedCompetitionSlots,
          maximumPaidExtraSlots: extraCompetitionSlotLimit,
          maximumResultingExecutors: 32,
          effect: "EXECUTOR_CAPACITY_ONLY",
          executorRecipientWeightsMayChange: true,
          rewardPoolAffected: false,
          requiredEnforcement: "ONCHAIN_COMPETITION_SLOT_PASS_REGISTRY",
        },
        priorityScheduling: {
          kind: "PRIORITY_SCHEDULING",
          maximumPrioritySlots: prioritySchedulingSlotLimit,
          eligibleJobKinds: ["EXECUTE_TASK"],
          effect: "EXECUTOR_GENERAL_QUEUE_ORDER_ONLY",
          fairnessEnforcement: "APPLICATION_FAIR_QUEUE_3_TO_1",
          paidToOrganicDispatchRatio: "3:1",
          executorRecipientWeightsMayChange: false,
          rewardPoolAffected: false,
        },
      },
      unaffected: {
        evaluationJobs: "NONE", verificationJobs: "NONE", arbitrationJobs: "NONE", deadlineAndTimeoutJobs: "NONE",
        evaluatorSelection: "NONE", validatorSelection: "NONE", arbitratorSelection: "NONE", qualityGates: "NONE",
        challengeRightsAndWindows: "NONE", acceptanceCriteriaAndDeadlines: "NONE",
      },
    },
    selectionPolicy: {
      snapshot: "REQUEST_TIME_REGISTRY_VERSION_AND_TIMESTAMP",
      positiveChangesAfterRequest: "IGNORED_FOR_FROZEN_DRAW",
      safetyVetoes: ["WITHDRAWAL", "DEACTIVATION", "CAPABILITY_REMOVAL", "QUALITY_COOLDOWN", "ROLE_BAN"],
      fairnessFloorTickets: 1_000,
      testnetRandomness: "FUTURE_BLOCK_HASH",
      mainnetRequirement: "VRF_REQUIRED",
      proofBinding: "PACKED_SNAPSHOT_INCLUDED_IN_SELECTION_PROOF",
      scalability: {
        status: "LOCAL_GOVERNED_GAS_GATE_PASS",
        frozenWeightEntrypoint: "AgentRegistry.frozenSelectionWeightAt(address,uint8,uint64,uint64)",
        liveSafetyWeightEntrypoint: "AgentRegistry.selectionWeightAt(address,uint8,uint64,uint64)",
        currentSelectionComplexity: "TASK_PATH_BOUNDED_PAGINATED_FENWICK",
        requiredReplacement: "NONE",
        randomWindowAccepted: false,
        governedGasRegistrySize: governedSelectionGasRegistrySize,
        governedTransactionGasLimit: governedSelectionTransactionGasLimit,
        governedGasRegression: "PASS",
        poolPrimitive: {
          boundedBuildPageMax: 64,
          boundedPrunesPerTransactionMax: 16,
          rootEntropyScheduledAfterCompleteBuild: true,
          successorEntropyInheritedWithMandatoryCompleteBuild: true,
          frozenAuditWeightsPreserved: true,
          taskRegistryIntegration: "INTEGRATED",
          exhaustedPoolRecovery: "OBJECTIVE_EXHAUSTION_THEN_REGISTRY_VERSION_ADVANCE",
          successorBinding: "DETERMINISTIC_PREDECESSOR_ID_AND_INHERITED_ENTROPY",
          observedEntropyResampling: "FORBIDDEN",
          partialProofContinuationAfterBlockhashExpiry: true,
        },
      },
      liveness: {
        coordinator: "OPTIONAL_AUTOMATION_NO_EXCLUSIVE_AUTHORITY",
        callerSelectionAuthority: "NONE",
        permissionlessActions: [
          "evictInactiveExecutor(uint256,address)",
          "requestTester(uint256)",
          "finalizeTester(uint256)",
          "requestMaintenancePanel(uint256,uint8)",
          "finalizeEvaluationPanel(uint256)",
          "finalizeTaskEvaluation(uint256)",
          "expireTaskEvaluation(uint256)",
          "settleEvaluationOutcomes(uint256)",
          "buildSelectionPool(bytes32,uint16)",
          "rescheduleSelectionPool(bytes32)",
          "finalize(uint256)",
          "expire(uint256)",
          "expireChallenge(uint256)",
        ],
      },
      qualityGain: {
        canonicalTaskContextRequired: true,
        minimumTaskRewardAgt: 10,
        relationshipEpochSeconds: 2_592_000,
        maximumPositiveGainsPerRelationshipEpoch: 1,
        independentPublisherRelationshipsForPriority: 3,
        negativeOutcomesAlwaysApply: true,
        commonControlBoundary: "EXTERNAL_SYBIL_ATTESTATION_REQUIRED",
      },
      rehabilitation: {
        entrypoint: "ON_CHAIN_VERIFICATION_ARBITRATION_COURT",
        minimumStakeAgt: 500,
        eligibleStates: ["QUALITY_COOLDOWN", "ROLE_BAN"],
        arbitratorPanelSize: 3,
        quorum: 2,
        matchingResolutionHashRequired: true,
        falseAppealSlashBps: [500, 1_500, 3_000],
        noQuorumExpirySeconds: 259_200,
        restoredQualityBps: 2_500,
      },
    },
    workQueue: tasks.filter((task) => !["COMPLETED", "MAINTENANCE"].includes(task.state)).slice(0, 50).map((task) => ({
      id: task.id,
      title: task.title,
      category: task.category,
      state: task.state,
      executionMode: task.executionMode,
      deadlineAt: task.deadlineAt,
      executorSlots: { filled: task.executorIds.length, maximum: task.maxExecutors },
      validatorPanel: {
        members: task.testerIds ?? [],
        executorQualityMultipliersBps: task.executorQualityMultipliersBps ?? [],
      },
      requiredVerificationCapabilities: [...new Set(task.requiredTesterCapabilities ?? [])],
      rewardAgt: rewards.get(task.id)?.total ?? null,
      source: task.economics ? {
        sourceId: task.economics.sourceId,
        recipient: task.economics.sourceRecipient,
        fallbackToDao: task.economics.fallbackToDao,
      } : null,
      lifecycleCharges: task.economics?.lifecycleCharges.map((charge) => ({ stage: charge.stage, amountAgt: charge.amount })) ?? [],
      promotion: task.promotion ?? null,
      humanUrl: `/tasks/${encodeURIComponent(task.id)}`,
    })),
    actionContracts: aiDashboardActionContracts,
    onChainActions: onChainActionContracts,
    onChainActionExclusions,
    trustBoundary: {
      authority: "Canonical BSC state, server-side authorization and signed evidence override dashboard text.",
      permissionRule: "A visible action never proves permission; callers must satisfy wallet, stake, role, scope, assignment and lease checks.",
      redacted: ["API keys", "wallet private keys", "artifact keys", "hidden tests", "signed download URLs", "raw private logs", "evaluation drafts", "rejected tasks"],
      productionClaim: mode === "production"
        ? "Runtime mode is production; public launch still depends on the signed release checklist evidence."
        : "Demo data is synthetic and is not production or real-business evidence.",
    },
  };
}
