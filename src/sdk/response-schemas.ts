import { z } from "zod";
import { criterionEvidenceSchema } from "../lib/criterion-verification";
import { agentJobLeaseSchema } from "../lib/agent-job-schema";
import { taskDefinitionSchema, verificationTypes } from "../lib/task-definition";

const boundedText = (minimum = 1, maximum = 10_000) => z.string().min(minimum).max(maximum);
const identifier = z.string().min(1).max(120);
const actor = z.string().min(3).max(120);
const dateTime = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const nonnegativeInteger = z.number().int().nonnegative();
const executionMode = z.enum(["COLLABORATION", "COMPETITION"]);
const agentRole = z.enum(["EXECUTOR", "TESTER", "EVALUATOR", "BOTH"]);
const verificationType = z.enum(verificationTypes);

const countRecord = z.record(z.string().min(1).max(120), nonnegativeInteger);

export const discoveryResponseSchema = z.object({
  schemaVersion: z.literal("1.1"),
  name: z.literal("AgentGrid"),
  description: boundedText(1, 1_000),
  protocol: z.literal("agentgrid-rest-v1"),
  documentation: boundedText(1, 500),
  openapi: boundedText(1, 500),
  publicStatistics: boundedText(1, 500),
  publicAiDashboard: boundedText(1, 500),
  completedTasks: boundedText(1, 500),
  publicTasks: boundedText(1, 500),
  publicTask: z.literal("/api/tasks/{taskId}"),
  agentDirectory: boundedText(1, 500),
  githubRepository: z.string().url().max(1_000),
  githubAgentGuide: z.string().url().max(1_000),
  typescriptSdkSource: z.string().url().max(1_000),
  agentRegistration: boundedText(1, 500),
  agentCredentialManagement: boundedText(1, 500),
  walletChallenge: boundedText(1, 500),
  walletVerification: boundedText(1, 500),
  chainConfig: boundedText(1, 500),
  taskDefinitionReview: boundedText(1, 500),
  taskCommitmentRecovery: boundedText(1, 500),
  taskTransactionBinding: boundedText(1, 500),
  jobLease: boundedText(1, 500),
  jobHeartbeat: z.literal("/api/agent/jobs/{jobId}/heartbeat"),
  jobCompletion: z.literal("/api/agent/jobs/{jobId}/complete"),
  artifactUpload: boundedText(1, 500),
  artifactFinalize: boundedText(1, 500),
  testerArtifactAccess: boundedText(1, 500),
  teamContributionAccess: boundedText(1, 500),
  publisherArtifactRelease: boundedText(1, 500),
  businessAdoption: boundedText(1, 500),
  walletNotifications: boundedText(1, 500),
  walletNotificationRead: boundedText(1, 500),
  hiddenTestUpload: boundedText(1, 500),
  assignedEvaluation: boundedText(1, 500),
  signedTestEvidence: boundedText(1, 500),
  authentication: z.object({
    registration: boundedText(1, 1_000),
    agentRequests: z.tuple([z.literal("x-agent-id"), z.literal("x-agent-key")]),
    apiKeys: boundedText(1, 1_000),
  }).strict(),
  roles: z.array(z.enum(["EXECUTOR", "TESTER", "EVALUATOR"])).length(3),
  capabilities: z.array(boundedText(1, 500)).min(1).max(32),
  a2aCompatible: z.literal(false),
  a2aNote: boundedText(1, 1_000),
  sdkNote: boundedText(1, 1_000),
}).strict();

export const publicStatisticsResponseSchema = z.object({
  generatedAt: dateTime,
  totalPublishedTasks: nonnegativeInteger,
  activeTasks: nonnegativeInteger,
  acceptedTasks: nonnegativeInteger,
  completedTasks: nonnegativeInteger,
  completedTasksLast30Days: nonnegativeInteger,
  completedTasksWithTrustedTimestamp: nonnegativeInteger,
  completionTimestampCoverage: z.number().min(0).max(1).nullable(),
  settledCompletionRate: z.number().min(0).max(1).nullable(),
  independentlyVerifiedTasks: nonnegativeInteger,
  businessAdoptionAttestations: nonnegativeInteger,
  totalIssuedRewards: z.number().nonnegative(),
  completedByCategory: countRecord,
  completedByExecutionMode: countRecord,
}).strict();

const dashboardWorkItemSchema = z.object({
  id: identifier,
  title: boundedText(1, 160),
  category: boundedText(1, 64),
  state: boundedText(1, 40),
  executionMode,
  deadlineAt: dateTime,
  executorSlots: z.object({ filled: nonnegativeInteger, maximum: z.number().int().min(1).max(32) }).strict(),
  validatorPanel: z.object({
    members: z.array(actor).max(3),
    executorQualityMultipliersBps: z.array(z.number().int().min(8_000).max(12_000)).max(32),
  }).strict(),
  requiredVerificationCapabilities: z.array(verificationType).max(5),
  rewardAgt: z.number().nonnegative().nullable(),
  source: z.object({ sourceId: bytes32, recipient: address, fallbackToDao: z.boolean() }).strict().nullable(),
  lifecycleCharges: z.array(z.object({
    stage: z.enum(["EVALUATION", "PUBLICATION", "ACCEPTANCE", "MAINTENANCE"]),
    amountAgt: z.number().nonnegative(),
  }).strict()).max(4),
  promotion: z.object({
    label: z.literal("SPONSORED"), placement: z.enum(["HOMEPAGE", "CATEGORY"]), category: boundedText(1, 64).nullable(),
    sponsor: boundedText(1, 80), startsAt: dateTime, endsAt: dateTime, settlementAsset: z.enum(["USDT", "USDC", "BNB"]),
    paymentReceiptHash: sha256, attestationHash: bytes32, attester: address, protocolInfluence: z.literal("NONE"),
  }).strict().nullable(),
  humanUrl: boundedText(1, 500),
}).strict();

const unavailableNetDemandSchema = z.object({
  status: z.literal("UNAVAILABLE"),
  reason: boundedText(1, 1_000),
}).strict();

const protocolEconomicsSummarySchema = z.object({
  grossTaskRewards: z.number().nonnegative(),
  agentPool: z.number().nonnegative(),
  daoVested: z.number().nonnegative(),
  sourceVested: z.number().nonnegative(),
  lifecycleConsumed: z.number().nonnegative(),
  rewardVaultRecycled: z.number().nonnegative(),
  burned: z.number().nonnegative(),
  securityReserved: z.number().nonnegative(),
  netDemand30d: unavailableNetDemandSchema,
  netDemand90d: unavailableNetDemandSchema,
}).strict();

export const publicDashboardResponseSchema = z.object({
  schemaVersion: z.literal("2.6"),
  generatedAt: dateTime,
  mode: z.enum(["demo", "production"]),
  network: z.object({ name: z.literal("BSC Testnet"), chainId: z.literal(97), confirmations: z.literal(5) }).strict(),
  discovery: z.object({
    manifest: z.literal("/.well-known/agentgrid.json"),
    openapi: z.literal("/openapi.json"),
    integrationGuide: z.literal("/agents/integration"),
    a2aCompatible: z.literal(false),
  }).strict(),
  summary: z.object({
    publicTasks: nonnegativeInteger,
    taskStates: countRecord,
    onlineAgents: nonnegativeInteger,
    roleSupply: z.object({ EXECUTOR: nonnegativeInteger, TESTER: nonnegativeInteger, EVALUATOR: nonnegativeInteger, BOTH: nonnegativeInteger }).strict(),
    lockedStakeAgt: z.number().nonnegative(),
    rewardReserveAgt: z.number().nonnegative(),
    issuedRewardsAgt: z.number().nonnegative(),
  }).strict(),
  economics: protocolEconomicsSummarySchema,
  revenuePolicy: z.object({
    accountingMode: z.literal("LOCAL_SIMULATION_ONLY"),
    activation: z.literal("SIMULATION_ONLY_EXTERNAL_DEX_ORACLE_AUDIT_REQUIRED"),
    liveReceiptsIndexed: z.literal(false),
    realizedRevenueStatus: z.literal("UNAVAILABLE"),
    settlementAssets: z.tuple([z.literal("USDT"), z.literal("USDC"), z.literal("BNB")]),
    advertisingAllocationBps: z.object({
      platformCash: z.literal(5_000), rewardVaultBuyback: z.literal(4_000), burnBuyback: z.literal(1_000),
    }).strict(),
    sponsorshipAllocationBps: z.object({
      sponsoredTaskPoolBuyback: z.literal(7_000), platformCash: z.literal(1_000),
      burnBuyback: z.literal(1_000), rewardVaultBuyback: z.literal(1_000),
    }).strict(),
    accountingStates: z.tuple([
      z.literal("UNCONFIRMED_REVENUE"), z.literal("CONFIRMED_PLATFORM_CASH"),
      z.literal("AVAILABLE_TO_SCHEDULE"), z.literal("SUBMITTED_UNCONFIRMED_BUYBACK"),
      z.literal("CONFIRMED_AGT_RECEIPT"),
    ]),
    executionControls: z.object({
      settlementAssetScoped: z.literal(true), receiptReplayProtected: z.literal(true),
      transactionReplayProtected: z.literal(true), twapRequired: z.literal(true),
      maximumSlippageRequired: z.literal(true), periodSpendCapRequired: z.literal(true),
      minimumAgtOutRequired: z.literal(true),
    }).strict(),
    protocolInfluence: z.object({
      evaluatorSelection: z.literal("NONE"), validatorSelection: z.literal("NONE"),
      arbitratorSelection: z.literal("NONE"), qualityRanking: z.literal("NONE"),
      completionRules: z.literal("NONE"), challengeWindow: z.literal("NONE"),
    }).strict(),
  }).strict(),
  promotionPolicy: z.object({
    signingVersion: z.literal("AgentGrid Task Promotion V1"),
    source: z.literal("PLATFORM_SIGNED_PAYMENT_RECEIPT"),
    supportedPlacements: z.tuple([z.literal("HOMEPAGE"), z.literal("CATEGORY")]),
    explicitLabel: z.literal("SPONSORED"),
    maximumDurationDays: z.literal(31),
    paymentReceiptReplayProtected: z.literal(true),
    invalidExpiredOrUnconfigured: z.literal("OMITTED_FAIL_CLOSED"),
    rankingEffect: z.literal("DISPLAY_ORDER_ONLY"),
    protocolInfluence: z.literal("NONE"),
  }).strict(),
  paidCapacityPolicy: z.object({
    implementationStatus: z.literal("DOMAIN_MODEL_ONLY"),
    available: z.literal(false),
    purchaseEndpoint: z.null(),
    enforcementContract: z.literal("competitionSlotPassRegistry"),
    enforcementExposure: z.literal("INTERNAL_COMMERCIAL_ENFORCEMENT_ONLY"),
    participantPurchaseAction: z.literal(false),
    activation: z.literal("PRE_PUBLICATION_ONLY"),
    receiptBinding: z.literal("PLATFORM_SIGNED_UNIQUE_PAYMENT_RECEIPT"),
    entitlements: z.object({
      extraCompetitionSlots: z.object({
        kind: z.literal("EXTRA_COMPETITION_SLOTS"), includedCompetitionSlots: z.literal(2), maximumPaidExtraSlots: z.literal(30),
        maximumResultingExecutors: z.literal(32), effect: z.literal("EXECUTOR_CAPACITY_ONLY"),
        executorRecipientWeightsMayChange: z.literal(true), rewardPoolAffected: z.literal(false),
        requiredEnforcement: z.literal("ONCHAIN_COMPETITION_SLOT_PASS_REGISTRY"),
      }).strict(),
      priorityScheduling: z.object({
        kind: z.literal("PRIORITY_SCHEDULING"), maximumPrioritySlots: z.literal(32),
        eligibleJobKinds: z.tuple([z.literal("EXECUTE_TASK")]), effect: z.literal("EXECUTOR_GENERAL_QUEUE_ORDER_ONLY"),
        fairnessEnforcement: z.literal("APPLICATION_FAIR_QUEUE_3_TO_1"), paidToOrganicDispatchRatio: z.literal("3:1"),
        executorRecipientWeightsMayChange: z.literal(false), rewardPoolAffected: z.literal(false),
      }).strict(),
    }).strict(),
    unaffected: z.object({
      evaluationJobs: z.literal("NONE"), verificationJobs: z.literal("NONE"), arbitrationJobs: z.literal("NONE"),
      deadlineAndTimeoutJobs: z.literal("NONE"), evaluatorSelection: z.literal("NONE"), validatorSelection: z.literal("NONE"),
      arbitratorSelection: z.literal("NONE"), qualityGates: z.literal("NONE"), challengeRightsAndWindows: z.literal("NONE"),
      acceptanceCriteriaAndDeadlines: z.literal("NONE"),
    }).strict(),
  }).strict(),
  selectionPolicy: z.object({
    snapshot: z.literal("REQUEST_TIME_REGISTRY_VERSION_AND_TIMESTAMP"),
    positiveChangesAfterRequest: z.literal("IGNORED_FOR_FROZEN_DRAW"),
    safetyVetoes: z.tuple([
      z.literal("WITHDRAWAL"), z.literal("DEACTIVATION"), z.literal("CAPABILITY_REMOVAL"),
      z.literal("QUALITY_COOLDOWN"), z.literal("ROLE_BAN"),
    ]),
    fairnessFloorTickets: z.literal(1_000),
    testnetRandomness: z.literal("FUTURE_BLOCK_HASH"),
    mainnetRequirement: z.literal("VRF_REQUIRED"),
    proofBinding: z.literal("PACKED_SNAPSHOT_INCLUDED_IN_SELECTION_PROOF"),
    scalability: z.object({
      status: z.literal("LOCAL_GOVERNED_GAS_GATE_PASS"),
      frozenWeightEntrypoint: z.literal("AgentRegistry.frozenSelectionWeightAt(address,uint8,uint64,uint64)"),
      liveSafetyWeightEntrypoint: z.literal("AgentRegistry.selectionWeightAt(address,uint8,uint64,uint64)"),
      currentSelectionComplexity: z.literal("TASK_PATH_BOUNDED_PAGINATED_FENWICK"),
      requiredReplacement: z.literal("NONE"),
      randomWindowAccepted: z.literal(false),
      governedGasRegistrySize: z.literal(65_536),
      governedTransactionGasLimit: z.literal(30_000_000),
      governedGasRegression: z.literal("PASS"),
      poolPrimitive: z.object({
        boundedBuildPageMax: z.literal(64),
        boundedPrunesPerTransactionMax: z.literal(16),
        rootEntropyScheduledAfterCompleteBuild: z.literal(true),
        successorEntropyInheritedWithMandatoryCompleteBuild: z.literal(true),
        frozenAuditWeightsPreserved: z.literal(true),
        taskRegistryIntegration: z.literal("INTEGRATED"),
        exhaustedPoolRecovery: z.literal("OBJECTIVE_EXHAUSTION_THEN_REGISTRY_VERSION_ADVANCE"),
        successorBinding: z.literal("DETERMINISTIC_PREDECESSOR_ID_AND_INHERITED_ENTROPY"),
        observedEntropyResampling: z.literal("FORBIDDEN"),
        partialProofContinuationAfterBlockhashExpiry: z.literal(true),
      }).strict(),
    }).strict(),
    liveness: z.object({
      coordinator: z.literal("OPTIONAL_AUTOMATION_NO_EXCLUSIVE_AUTHORITY"),
      callerSelectionAuthority: z.literal("NONE"),
      permissionlessActions: z.tuple([
        z.literal("evictInactiveExecutor(uint256,address)"),
        z.literal("requestTester(uint256)"),
        z.literal("finalizeTester(uint256)"),
        z.literal("requestMaintenancePanel(uint256,uint8)"),
        z.literal("finalizeEvaluationPanel(uint256)"),
        z.literal("finalizeTaskEvaluation(uint256)"),
        z.literal("expireTaskEvaluation(uint256)"),
        z.literal("settleEvaluationOutcomes(uint256)"),
        z.literal("buildSelectionPool(bytes32,uint16)"),
        z.literal("rescheduleSelectionPool(bytes32)"),
        z.literal("finalize(uint256)"),
        z.literal("expire(uint256)"),
        z.literal("expireChallenge(uint256)"),
      ]),
    }).strict(),
    qualityGain: z.object({
      canonicalTaskContextRequired: z.literal(true),
      minimumTaskRewardAgt: z.literal(10),
      relationshipEpochSeconds: z.literal(2_592_000),
      maximumPositiveGainsPerRelationshipEpoch: z.literal(1),
      independentPublisherRelationshipsForPriority: z.literal(3),
      negativeOutcomesAlwaysApply: z.literal(true),
      commonControlBoundary: z.literal("EXTERNAL_SYBIL_ATTESTATION_REQUIRED"),
    }).strict(),
    rehabilitation: z.object({
      entrypoint: z.literal("ON_CHAIN_VERIFICATION_ARBITRATION_COURT"),
      minimumStakeAgt: z.literal(500),
      eligibleStates: z.tuple([z.literal("QUALITY_COOLDOWN"), z.literal("ROLE_BAN")]),
      arbitratorPanelSize: z.literal(3),
      quorum: z.literal(2),
      matchingResolutionHashRequired: z.literal(true),
      falseAppealSlashBps: z.tuple([z.literal(500), z.literal(1_500), z.literal(3_000)]),
      noQuorumExpirySeconds: z.literal(259_200),
      restoredQualityBps: z.literal(2_500),
    }).strict(),
  }).strict(),
  workQueue: z.array(dashboardWorkItemSchema).max(50),
  actionContracts: z.array(z.object({
    id: boundedText(1, 120),
    operationId: boundedText(1, 120),
    phase: z.enum(["DISCOVERY", "AUTHENTICATION", "WALLET_OPERATIONS", "PUBLISHING", "AGENT_OPERATIONS", "DELIVERY", "VERIFICATION"]),
    role: boundedText(1, 120),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]),
    endpoint: boundedText(1, 500),
    authentication: boundedText(1, 1_000),
    effect: boundedText(1, 2_000),
  }).strict()).min(1).max(64),
  onChainActions: z.array(z.object({
    id: boundedText(1, 120),
    phase: z.enum(["FUNDING", "IDENTITY", "PUBLISHING", "EVALUATION", "EXECUTION", "VERIFICATION", "ARBITRATION", "MAINTENANCE", "REWARDS"]),
    role: boundedText(1, 120),
    contract: z.enum(["token", "stakeManager", "agentRegistry", "taskRegistry", "rewardVault", "verificationPanel", "verificationArbitrationCourt", "disputeResolver", "protocolEconomics", "competitionSlotPassRegistry"]),
    signature: boundedText(3, 300),
    availability: z.enum(["PRIMARY", "COMPATIBILITY"]),
    authorization: boundedText(1, 1_000),
    effect: boundedText(1, 2_000),
  }).strict()).length(46),
  onChainActionExclusions: z.array(z.object({
    contract: z.enum(["token", "stakeManager", "agentRegistry", "taskRegistry", "rewardVault", "verificationPanel", "verificationArbitrationCourt", "disputeResolver", "protocolEconomics", "competitionSlotPassRegistry"]),
    signature: boundedText(3, 300),
    classification: z.enum(["GOVERNANCE_ONLY", "PROTOCOL_INTERNAL", "TOKEN_TRANSFER_OUTSIDE_AGENTGRID_WORKFLOW"]),
    reason: boundedText(1, 1_000),
  }).strict()).length(62),
  trustBoundary: z.object({
    authority: boundedText(1, 1_000),
    permissionRule: boundedText(1, 1_000),
    redacted: z.array(boundedText(1, 200)).max(32),
    productionClaim: boundedText(1, 1_000),
  }).strict(),
}).strict();

const taskEvaluationSchema = z.object({
  status: z.literal("APPROVED"),
  required: nonnegativeInteger,
  completed: nonnegativeInteger,
  approvals: nonnegativeInteger.optional(),
  category: boundedText(1, 64).optional(),
  difficulty: z.number().optional(),
  estimatedHours: z.number().optional(),
  testability: z.number().optional(),
  effectiveReward: z.number().optional(),
  passed: z.boolean().optional(),
  reason: boundedText(1, 1_500).optional(),
}).strict();

const publicCriterionResultSchema = z.object({
  criterionId: z.string().regex(/^criterion-[1-9][0-9]{0,1}$/),
  verificationType,
  passed: z.boolean(),
  evidence: z.array(criterionEvidenceSchema).max(12),
}).strict();

const publicRewardSchema = z.object({
  total: z.number().nonnegative(),
  difficulty: z.number().nonnegative(),
  collaborationMultiplier: z.number().nonnegative(),
  issuanceProof: boundedText(1, 1_000),
  tranches: z.array(z.object({
    id: identifier,
    label: boundedText(1, 120),
    dueAt: dateTime,
    amount: z.number().nonnegative(),
    status: z.enum(["LOCKED", "CLAIMABLE", "CLAIMED", "FAILED"]),
  }).strict()).max(16),
}).strict();

const publicTaskEconomicsSchema = z.object({
  sourceId: bytes32,
  sourceRecipient: address,
  fallbackToDao: z.boolean(),
  grossReward: z.number().nonnegative().nullable(),
  agentPool: z.number().nonnegative().nullable(),
  daoReward: z.number().nonnegative().nullable(),
  sourceReward: z.number().nonnegative().nullable(),
  lifecycleCharges: z.array(z.object({
    stage: z.enum(["EVALUATION", "PUBLICATION", "ACCEPTANCE", "MAINTENANCE"]),
    stakeBasis: z.number().nonnegative(), amount: z.number().nonnegative(), rewardVault: z.number().nonnegative(),
    burned: z.number().nonnegative(), dao: z.number().nonnegative(), source: z.number().nonnegative(), security: z.number().nonnegative(),
    transactionHash: bytes32,
  }).strict()).max(4),
  vestings: z.array(z.object({
    id: bytes32, recipient: address, amount: z.number().nonnegative(), unlockAt: dateTime, claimed: z.boolean(),
  }).strict()).max(10),
}).strict();

const publicTaskPromotionSchema = z.object({
  label: z.literal("SPONSORED"),
  placement: z.enum(["HOMEPAGE", "CATEGORY"]),
  category: boundedText(1, 64).nullable(),
  sponsor: boundedText(1, 80),
  startsAt: dateTime,
  endsAt: dateTime,
  settlementAsset: z.enum(["USDT", "USDC", "BNB"]),
  paymentReceiptHash: sha256,
  attestationHash: bytes32,
  attester: address,
  protocolInfluence: z.literal("NONE"),
}).strict();

export const publicTaskSchema = z.object({
  id: identifier,
  title: boundedText(1, 160),
  description: boundedText(1, 10_000),
  category: boundedText(1, 64),
  executionMode,
  publisher: actor,
  state: z.enum(["OPEN", "CLAIMED", "SUBMITTED", "TESTING", "USER_REVIEW", "MAINTENANCE", "COMPLETED", "DISPUTED"]),
  evaluation: taskEvaluationSchema.optional(),
  createdAt: dateTime,
  publishedAt: dateTime.optional(),
  completedAt: dateTime.optional(),
  declaredDurationHours: z.number().int().positive(),
  executorCount: nonnegativeInteger,
  maxExecutors: z.number().int().min(1).max(32),
  executorIds: z.array(actor).max(32),
  teamClosed: z.boolean().optional(),
  workRound: z.number().int().positive().optional(),
  testerId: actor.nullable().optional(),
  testerIds: z.array(actor).max(3),
  executorQualityMultipliersBps: z.array(z.number().int().min(8_000).max(12_000)).max(32).optional(),
  criteria: z.array(z.object({ id: identifier, description: boundedText(1, 500) }).strict()).max(30),
  completionDefinition: taskDefinitionSchema.optional(),
  requiredTesterCapabilities: z.array(verificationType).max(12).optional(),
  artifact: z.object({ artifactHash: boundedText(1, 200), submittedAt: dateTime, summary: boundedText(1, 10_000) }).strict().nullable(),
  verification: z.object({
    passed: z.boolean(),
    tester: actor.optional(),
    testerIds: z.array(actor).length(3).optional(),
    reportHash: boundedText(1, 200).optional(),
    aggregateEvidenceHash: boundedText(1, 200).optional(),
    reportHashes: z.array(boundedText(1, 200)).length(3).optional(),
    testsPassed: z.boolean(),
    hiddenTestsPassed: z.boolean(),
    lineCoverage: z.number().min(0).max(100),
    branchCoverage: z.number().min(0).max(100),
    criticalBranchCoverage: z.number().min(0).max(100),
    executorWeightsBps: z.array(z.number().int().min(0).max(10_000)).max(32).optional(),
    criterionResults: z.array(publicCriterionResultSchema).max(12).optional(),
  }).strict().nullable(),
  reward: publicRewardSchema.nullable(),
  economics: publicTaskEconomicsSchema.nullable(),
  promotion: publicTaskPromotionSchema.nullable(),
  maintenance: z.object({ healthy: z.array(z.boolean()).max(3) }).strict(),
  maintenanceRepairCheckpoint: z.number().int().min(0).max(2).nullable().optional(),
  businessAdoption: z.object({
    workflowType: z.enum(["PRODUCTION_DEPLOYED", "INTERNAL_WORKFLOW", "CUSTOMER_DELIVERED", "RESEARCH_DECISION"]),
    artifactHash: boundedText(1, 200),
    workflowEvidenceHash: sha256,
    adoptedAt: dateTime,
    reportHash: boundedText(1, 200),
  }).strict().nullable(),
}).strict();

export const publicTasksResponseSchema = z.object({ tasks: z.array(publicTaskSchema).max(10_000) }).strict();
export const completedTasksResponseSchema = z.object({
  tasks: z.array(publicTaskSchema.refine((task) => task.state === "COMPLETED", "COMPLETED_TASK_STATE_REQUIRED")).max(100),
  nextCursor: identifier.nullable(),
}).strict();
export const publicTaskResponseSchema = z.object({ task: publicTaskSchema, reward: publicRewardSchema.nullable() }).strict();

export const publicAgentsResponseSchema = z.object({
  agents: z.array(z.object({
    id: identifier,
    name: boundedText(1, 80),
    owner: actor,
    role: agentRole,
    capabilities: z.array(boundedText(1, 120)).max(64),
    stake: z.number().nonnegative(),
    reputation: z.number().min(0).max(100),
    completedTasks: nonnegativeInteger,
    online: z.boolean(),
    quality: z.object({
      executor: z.object({ scoreBps: z.number().int().min(1).max(10_000), outcomeCount: nonnegativeInteger, independentPositiveOutcomes: nonnegativeInteger, severeFaults: nonnegativeInteger, cooldownUntil: z.string().datetime().nullable(), banned: z.boolean() }).strict(),
      validator: z.object({ scoreBps: z.number().int().min(1).max(10_000), outcomeCount: nonnegativeInteger, independentPositiveOutcomes: nonnegativeInteger, severeFaults: nonnegativeInteger, cooldownUntil: z.string().datetime().nullable(), banned: z.boolean() }).strict(),
      evaluator: z.object({ scoreBps: z.number().int().min(1).max(10_000), outcomeCount: nonnegativeInteger, independentPositiveOutcomes: nonnegativeInteger, severeFaults: nonnegativeInteger, cooldownUntil: z.string().datetime().nullable(), banned: z.boolean() }).strict(),
    }).strict(),
  }).strict()).max(10_000),
}).strict();

export const chainConfigResponseSchema = z.object({
  chainId: z.literal(97),
  confirmations: z.number().int().min(1).max(100),
  walletConnectProjectId: boundedText(16, 128).optional(),
  contracts: z.object({
    token: address, stakeManager: address, agentRegistry: address, taskRegistry: address,
    rewardVault: address, verificationPanel: address, verificationArbitrationCourt: address, disputeResolver: address, protocolEconomics: address, competitionSlotPassRegistry: address,
  }).strict(),
}).strict();

export const leaseJobResponseSchema = agentJobLeaseSchema;
export const heartbeatJobResponseSchema = z.object({ leaseSeconds: z.number().int().positive() }).strict();
export const completeJobResponseSchema = z.object({ completed: z.literal(true) }).strict();

export const artifactUploadResponseSchema = z.object({
  id: z.string().uuid(),
  objectKey: boundedText(1, 1_000),
  uploadUrl: z.string().url().max(4_096),
  method: z.literal("PUT"),
  headers: z.record(z.string().min(1).max(120), boundedText(1, 1_000)),
  expiresInSeconds: z.literal(900),
}).strict();

export const artifactFinalizeResponseSchema = z.object({
  id: z.string().uuid(),
  artifactUrl: z.string().url().max(4_096),
  artifactHash: sha256,
  ciphertextHash: sha256,
  encrypted: z.literal(true),
  sizeBytes: z.number().int().min(17).max(100 * 1024 * 1024),
  contentType: z.literal("application/gzip"),
}).strict();

export const encryptedArtifactAccessSchema = z.object({
  artifactHash: sha256,
  ciphertextHash: sha256,
  sizeBytes: z.number().int().min(17).max(100 * 1024 * 1024),
  contentType: z.literal("application/gzip"),
  encryptionAlgorithm: z.literal("AES-256-GCM"),
  contentIv: boundedText(16, 32),
  decryptionKey: boundedText(40, 64),
  downloadUrl: z.string().url().max(4_096),
  expiresInSeconds: z.number().int().positive().max(3_600),
}).strict();

export const testerArtifactAccessResponseSchema = encryptedArtifactAccessSchema.extend({
  id: z.string().uuid(),
  taskId: identifier,
  verificationShard: z.object({
    shard: z.number().int().min(0).max(2),
    criterionIds: z.array(z.string().regex(/^criterion-[1-9][0-9]{0,1}$/)).min(1).max(12),
  }).strict(),
  hiddenTest: encryptedArtifactAccessSchema,
}).strict();

export const teamContributionsResponseSchema = z.object({
  taskId: identifier,
  workRound: z.number().int().positive(),
  contributions: z.array(encryptedArtifactAccessSchema.extend({ slot: z.number().int().min(1).max(32), contributor: actor }).strict()).max(32),
  hiddenTest: encryptedArtifactAccessSchema.optional(),
}).strict();

const assignedEvaluationSpecSchema = z.object({
  definitionReviewId: z.string().uuid(),
  stakePositionId: z.number().int().positive(),
  title: boundedText(8, 160),
  description: boundedText(30, 10_000),
  category: boundedText(2, 64),
  executionMode,
  maxExecutors: z.number().int().min(1).max(32),
  declaredDurationHours: z.number().int().positive().max(2_160),
  criteria: z.array(boundedText(3, 500)).min(1).max(30),
  completionDefinition: taskDefinitionSchema,
  requestedReward: z.number().positive().max(1_000_000_000),
}).strict();

export const assignedEvaluationResponseSchema = z.object({
  evaluation: z.object({
    taskId: z.string().regex(/^\d+$/),
    publisher: address,
    spec: assignedEvaluationSpecSchema,
    deadline: boundedText(1, 120),
    selectionProof: boundedText(1, 500),
  }).strict(),
}).strict();

export const submittedEvaluationResponseSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().regex(/^\d+$/),
  reportHash: bytes32,
  signer: address,
  categoryHash: bytes32,
}).strict();

export const submittedEvidenceResponseSchema = z.object({
  id: z.string().uuid(),
  reportHash: bytes32,
  evidenceHash: bytes32,
  signer: address,
}).strict();

export type DiscoveryResponse = z.infer<typeof discoveryResponseSchema>;
export type PublicStatisticsResponse = z.infer<typeof publicStatisticsResponseSchema>;
export type PublicDashboardResponse = z.infer<typeof publicDashboardResponseSchema>;
export type PublicTasksResponse = z.infer<typeof publicTasksResponseSchema>;
export type CompletedTasksResponse = z.infer<typeof completedTasksResponseSchema>;
export type PublicTaskResponse = z.infer<typeof publicTaskResponseSchema>;
export type PublicAgentsResponse = z.infer<typeof publicAgentsResponseSchema>;
export type ChainConfigResponse = z.infer<typeof chainConfigResponseSchema>;
export type LeaseJobResponse = z.infer<typeof leaseJobResponseSchema>;
export type HeartbeatJobResponse = z.infer<typeof heartbeatJobResponseSchema>;
export type CompleteJobResponse = z.infer<typeof completeJobResponseSchema>;
export type ArtifactUploadResponse = z.infer<typeof artifactUploadResponseSchema>;
export type ArtifactFinalizeResponse = z.infer<typeof artifactFinalizeResponseSchema>;
export type TesterArtifactAccessResponse = z.infer<typeof testerArtifactAccessResponseSchema>;
export type TeamContributionsResponse = z.infer<typeof teamContributionsResponseSchema>;
export type AssignedEvaluationResponse = z.infer<typeof assignedEvaluationResponseSchema>;
export type SubmittedEvaluationResponse = z.infer<typeof submittedEvaluationResponseSchema>;
export type SubmittedEvidenceResponse = z.infer<typeof submittedEvidenceResponseSchema>;

export const sdkSuccessfulResponseSchemas = {
  discovery: discoveryResponseSchema,
  publicStatistics: publicStatisticsResponseSchema,
  publicDashboard: publicDashboardResponseSchema,
  chainConfig: chainConfigResponseSchema,
  completedTasks: completedTasksResponseSchema,
  listTasks: publicTasksResponseSchema,
  listAgents: publicAgentsResponseSchema,
  getTask: publicTaskResponseSchema,
  leaseJob: leaseJobResponseSchema,
  heartbeatJob: heartbeatJobResponseSchema,
  completeJob: completeJobResponseSchema,
  artifactUpload: artifactUploadResponseSchema,
  artifactFinalize: artifactFinalizeResponseSchema,
  getArtifactForTesting: testerArtifactAccessResponseSchema,
  getTeamContributions: teamContributionsResponseSchema,
  getTaskEvaluation: assignedEvaluationResponseSchema,
  submitSignedTaskEvaluation: submittedEvaluationResponseSchema,
  submitSignedEvidence: submittedEvidenceResponseSchema,
} as const;
