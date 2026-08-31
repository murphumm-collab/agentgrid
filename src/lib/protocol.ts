import { createHash, randomUUID } from "node:crypto";
import type {
  Agent,
  ProtocolConfig,
  RewardGrant,
  SoftwareEvidence,
  StakePosition,
  Task,
  TestResult,
} from "./types";

export const DEFAULT_CONFIG: ProtocolConfig = {
  epochId: "epoch-001",
  epochRewardBudget: 100_000,
  epochRewardIssued: 0,
  minPublisherStake: 1_000,
  minAgentStake: 250,
  taskCreditTtlDays: 30,
  rewardCapRatio: 0.2,
  maintenanceDays: [0, 7, 30, 90],
  maintenanceShares: [0.4, 0.2, 0.2, 0.2],
  collaborationMultipliers: [1, 0.7, 0.4, 0.2, 0.1],
};

export function protocolHash(...parts: Array<string | number | boolean>): string {
  return `sha256:${createHash("sha256").update(parts.join("|")).digest("hex")}`;
}
export function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function calculateDifficulty(task: Pick<Task, "executorIds" | "declaredDurationHours" | "maxExecutors">): number {
  const uniqueExecutors = new Set(task.executorIds).size || 1;
  const agents = Math.min(Math.max(uniqueExecutors, 1), Math.min(task.maxExecutors, 32));
  const hours = Math.min(Math.max(task.declaredDurationHours, 0.25), 720);
  return Math.min(24, Math.max(1, Math.sqrt(agents) * Math.log2(1 + hours)));
}

export function issueTaskCredit(position: StakePosition, now: string, config = DEFAULT_CONFIG): StakePosition {
  if (position.activeTaskId) throw new Error("ACTIVE_TASK_EXISTS");
  if (position.amount < config.minPublisherStake) throw new Error("INSUFFICIENT_STAKE");
  if (position.creditExpiresAt && new Date(position.creditExpiresAt) >= new Date(now)) {
    throw new Error("LIVE_CREDIT_EXISTS");
  }
  return { ...position, creditExpiresAt: addDays(now, config.taskCreditTtlDays) };
}

export function consumeTaskCredit(position: StakePosition, taskId: string, now: string): StakePosition {
  if (position.activeTaskId) throw new Error("ACTIVE_TASK_EXISTS");
  if (!position.creditExpiresAt || new Date(position.creditExpiresAt) < new Date(now)) {
    throw new Error("TASK_CREDIT_REQUIRED");
  }
  return { ...position, activeTaskId: taskId, creditExpiresAt: null };
}

export function releaseTaskSlot(position: StakePosition, taskId: string): StakePosition {
  if (position.activeTaskId !== taskId) throw new Error("TASK_SLOT_MISMATCH");
  return { ...position, activeTaskId: null, creditExpiresAt: null };
}

export function selectRandomTester(
  task: Task,
  agents: Agent[],
  randomness: string,
): { tester: Agent; proof: string } {
  const excluded = new Set([task.publisher, ...task.executorIds]);
  const candidates = agents.filter(
    (agent) =>
      agent.online &&
      agent.stake >= DEFAULT_CONFIG.minAgentStake &&
      (agent.role === "TESTER" || agent.role === "BOTH") &&
      (task.requiredTesterCapabilities ?? []).every((capability) => agent.capabilities.includes(capability)) &&
      !excluded.has(agent.id) &&
      !excluded.has(agent.owner),
  );
  if (!candidates.length) throw new Error("NO_ELIGIBLE_TESTER");
  const ranked = [...candidates].sort((a, b) =>
    protocolHash(randomness, task.id, a.id).localeCompare(protocolHash(randomness, task.id, b.id)),
  );
  const tester = ranked[0];
  return { tester, proof: protocolHash(randomness, task.id, tester.id, candidates.map((a) => a.id).sort().join(",")) };
}

export function validateSoftwareEvidence(evidence: SoftwareEvidence): { passed: boolean; failures: string[] } {
  const coverage = [evidence.lineCoverage, evidence.branchCoverage, evidence.criticalBranchCoverage];
  if (coverage.some((value) => value < 0 || value > 1)) throw new Error("INVALID_COVERAGE");
  const failures: string[] = [];
  if (!evidence.testsPassed) failures.push("TESTS_FAILED");
  if (!evidence.hiddenTestsPassed) failures.push("HIDDEN_TESTS_FAILED");
  if (evidence.lineCoverage < 0.85) failures.push("LINE_COVERAGE_LOW");
  if (evidence.branchCoverage < 0.8) failures.push("BRANCH_COVERAGE_LOW");
  if (evidence.criticalBranchCoverage < 0.95) failures.push("CRITICAL_COVERAGE_LOW");
  if (!evidence.artifactHash.startsWith("sha256:")) failures.push("INVALID_ARTIFACT_HASH");
  return { passed: failures.length === 0, failures };
}

export function collaborationKey(task: Task): string {
  return protocolHash(task.publisher, [...task.executorIds].sort().join(","), task.testerId ?? "none");
}

export function collaborationMultiplier(count: number, config = DEFAULT_CONFIG): number {
  if (count < 0) throw new Error("INVALID_COLLABORATION_COUNT");
  return config.collaborationMultipliers[Math.min(count, config.collaborationMultipliers.length - 1)];
}

export interface RewardValidationInput {
  task: Task;
  position: StakePosition;
  testResult: TestResult;
  config: ProtocolConfig;
  priorCollaborationCount: number;
  now: string;
  existingGrant?: RewardGrant;
}

export function validateAndCreateReward(input: RewardValidationInput): RewardGrant {
  const { task, position, testResult, config, priorCollaborationCount, now, existingGrant } = input;
  if (existingGrant || task.rewardGrantId) throw new Error("REWARD_ALREADY_ISSUED");
  if (task.state !== "USER_REVIEW") throw new Error("TASK_NOT_REWARD_ELIGIBLE");
  if (!testResult.passed || testResult.failures.length) throw new Error("TEST_NOT_PASSED");
  if (!task.testerId || testResult.testerId !== task.testerId) throw new Error("TESTER_MISMATCH");
  if (task.executorIds.includes(task.testerId) || task.publisher === task.testerId) {
    throw new Error("TESTER_NOT_INDEPENDENT");
  }
  const evidenceDecision = validateSoftwareEvidence(testResult);
  if (!evidenceDecision.passed) throw new Error("INVALID_TEST_EVIDENCE");
  if (position.activeTaskId !== task.id) throw new Error("POSITION_TASK_MISMATCH");

  const difficulty = calculateDifficulty(task);
  const multiplier = collaborationMultiplier(priorCollaborationCount, config);
  const baseReward = 300 * difficulty;
  const cappedReward = Math.min(baseReward, position.amount * config.rewardCapRatio);
  const total = Math.floor(cappedReward * multiplier * 100) / 100;
  if (total <= 0) throw new Error("ZERO_REWARD");
  if (config.epochRewardIssued + total > config.epochRewardBudget) throw new Error("EPOCH_BUDGET_EXCEEDED");
  if (config.maintenanceDays.length !== config.maintenanceShares.length) throw new Error("INVALID_MAINTENANCE_CONFIG");
  const shareTotal = config.maintenanceShares.reduce((sum, share) => sum + share, 0);
  if (Math.abs(shareTotal - 1) > 1e-9) throw new Error("INVALID_MAINTENANCE_SHARES");

  const grantId = randomUUID();
  const tranches = config.maintenanceDays.map((day, index) => ({
    id: `${grantId}:${index}`,
    label: index === 0 ? "Delivery" : `Maintenance day ${day}`,
    dueAt: addDays(now, day),
    amount: Math.floor(total * config.maintenanceShares[index] * 100) / 100,
    status: index === 0 ? ("CLAIMABLE" as const) : ("LOCKED" as const),
  }));
  const roundingDelta = Math.round((total - tranches.reduce((sum, tranche) => sum + tranche.amount, 0)) * 100) / 100;
  tranches[tranches.length - 1].amount += roundingDelta;

  return {
    id: grantId,
    taskId: task.id,
    epochId: config.epochId,
    total,
    difficulty,
    collaborationMultiplier: multiplier,
    issuanceProof: protocolHash(task.id, config.epochId, total, testResult.selectionProof, testResult.artifactHash),
    tranches,
  };
}
