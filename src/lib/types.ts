import type { CriterionVerificationResult } from "./criterion-verification";
import type { TaskDefinition } from "./task-definition";

export type TaskState =
  | "EVALUATING"
  | "OPEN"
  | "CLAIMED"
  | "SUBMITTED"
  | "TESTING"
  | "USER_REVIEW"
  | "MAINTENANCE"
  | "COMPLETED"
  | "DISPUTED"
  | "REJECTED";

export type AgentRole = "EXECUTOR" | "TESTER" | "EVALUATOR" | "BOTH";
export type AgentScope = "tasks:claim" | "tasks:submit" | "tests:submit" | "evaluations:submit" | "heartbeat:write";
export type ExecutionMode = "COLLABORATION" | "COMPETITION";

export interface AgentRoleQuality {
  scoreBps: number;
  outcomeCount: number;
  severeFaults: number;
  cooldownUntil: string | null;
  banned: boolean;
}

export interface AgentQuality {
  executor: AgentRoleQuality;
  validator: AgentRoleQuality;
  evaluator: AgentRoleQuality;
}

export interface Agent {
  id: string;
  name: string;
  owner: string;
  role: AgentRole;
  capabilities: string[];
  endpoint: string;
  apiKey?: string;
  apiKeyHash?: string;
  apiKeySalt?: string;
  scopes?: AgentScope[];
  revokedAt?: string | null;
  stakePositionId?: string;
  stake: number;
  reputation: number;
  completedTasks: number;
  online: boolean;
  quality?: AgentQuality;
}

export interface StakePosition {
  id: string;
  owner: string;
  amount: number;
  activeTaskId: string | null;
  creditExpiresAt: string | null;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface SoftwareEvidence {
  testsPassed: boolean;
  hiddenTestsPassed: boolean;
  lineCoverage: number;
  branchCoverage: number;
  criticalBranchCoverage: number;
  artifactHash: string;
  logUrl?: string;
}

export interface Submission {
  artifactUrl: string;
  artifactHash: string;
  summary: string;
  submittedAt: string;
}

export interface TestResult extends SoftwareEvidence {
  testerId: string;
  testerIds?: string[];
  reportHashes?: string[];
  passed: boolean;
  failures: string[];
  submittedAt: string;
  selectionProof: string;
  reportHash?: string;
  executorWeightsBps?: number[];
  contributionWork?: Array<{ contributor: string; acceptedBytes: number; acceptedFiles: number; weightBps: number }>;
  competition?: {
    winner: string | null;
    selectedArtifactHash: string | null;
    candidates: Array<{ contributor: string; artifactHash: string; passed: boolean; lineCoverage: number; branchCoverage: number; functionCoverage: number; criticalBranchCoverage: number; scoreBps: number }>;
  };
  criterionResults?: CriterionVerificationResult[];
}

export interface RewardTranche {
  id: string;
  label: string;
  dueAt: string;
  amount: number;
  status: "LOCKED" | "CLAIMABLE" | "CLAIMED" | "FAILED";
}

export interface RewardGrant {
  id: string;
  taskId: string;
  epochId: string;
  total: number;
  difficulty: number;
  collaborationMultiplier: number;
  issuanceProof: string;
  tranches: RewardTranche[];
}

export type TaskEvaluationStatus = "PENDING" | "ASSIGNING" | "IN_PROGRESS" | "APPROVED" | "REJECTED";

export interface TaskEvaluation {
  status: TaskEvaluationStatus;
  required: number;
  completed: number;
  approvals?: number;
  category?: string;
  difficulty?: number;
  estimatedHours?: number;
  testability?: number;
  effectiveReward?: number;
  passed?: boolean;
  reason?: string;
}

export interface BusinessAdoption {
  publisher: string;
  artifactHash: string;
  workflowType: "PRODUCTION_DEPLOYED" | "INTERNAL_WORKFLOW" | "CUSTOMER_DELIVERED" | "RESEARCH_DECISION";
  workflowEvidenceHash: string;
  adoptedAt: string;
  reportHash: string;
  attestedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  category: string;
  executionMode: ExecutionMode;
  evaluation?: TaskEvaluation;
  publisher: string;
  stakePositionId: string;
  state: TaskState;
  maxExecutors: number;
  declaredDurationHours: number;
  createdAt: string;
  publishedAt?: string;
  completedAt?: string;
  deadlineAt: string;
  executorIds: string[];
  teamClosed?: boolean;
  contributionHashes?: Record<string, string>;
  workRound?: number;
  testerId: string | null;
  testerIds?: string[];
  executorQualityMultipliersBps?: number[];
  testerSelectionProof: string | null;
  criteria: AcceptanceCriterion[];
  completionDefinition?: TaskDefinition;
  requiredTesterCapabilities?: TaskDefinition["acceptanceCriteria"][number]["verificationType"][];
  submission: Submission | null;
  testResult: TestResult | null;
  rewardGrantId: string | null;
  maintenanceHealthy: boolean[];
  maintenanceRepairCheckpoint?: number | null;
  maintenanceRewardDistribution?: {
    fromCheckpoint: number;
    executors: string[];
    weightsBps: number[];
    tester: string;
    proof: string;
  };
  businessAdoption?: BusinessAdoption;
  economics?: TaskEconomics;
}

export type LifecycleEconomicsStage = "EVALUATION" | "PUBLICATION" | "ACCEPTANCE" | "MAINTENANCE";

export interface EconomicsVesting {
  id: string;
  recipient: string;
  amount: number;
  unlockAt: string;
  claimed: boolean;
}

export interface LifecycleEconomicsCharge {
  stage: LifecycleEconomicsStage;
  stakeBasis: number;
  amount: number;
  rewardVault: number;
  burned: number;
  dao: number;
  source: number;
  security: number;
  transactionHash: string;
}

export interface TaskEconomics {
  sourceId: string;
  sourceRecipient: string;
  fallbackToDao: boolean;
  grossReward?: number;
  agentPool?: number;
  daoReward?: number;
  sourceReward?: number;
  lifecycleCharges: LifecycleEconomicsCharge[];
  vestings: EconomicsVesting[];
}

export interface ProtocolEconomicsSummary {
  grossTaskRewards: number;
  agentPool: number;
  daoVested: number;
  sourceVested: number;
  lifecycleConsumed: number;
  rewardVaultRecycled: number;
  burned: number;
  securityReserved: number;
  netDemand30d: { status: "UNAVAILABLE"; reason: string };
  netDemand90d: { status: "UNAVAILABLE"; reason: string };
}

export interface LedgerEntry {
  id: string;
  type: "FAUCET" | "STAKE" | "UNSTAKE" | "REWARD" | "SLASH" | "BURN";
  owner: string;
  amount: number;
  taskId?: string;
  proof: string;
  createdAt: string;
}

export interface ProtocolConfig {
  epochId: string;
  epochRewardBudget: number;
  epochRewardIssued: number;
  minPublisherStake: number;
  minAgentStake: number;
  taskCreditTtlDays: number;
  rewardCapRatio: number;
  maintenanceDays: number[];
  maintenanceShares: number[];
  collaborationMultipliers: number[];
}

export interface ProtocolDatabase {
  config: ProtocolConfig;
  balances: Record<string, number>;
  positions: StakePosition[];
  agents: Agent[];
  tasks: Task[];
  rewards: RewardGrant[];
  ledger: LedgerEntry[];
  collaborationCounts: Record<string, number>;
}
