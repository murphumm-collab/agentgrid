import type { RewardGrant, Task } from "./types";

export function publicTaskView(task: Task, reward?: RewardGrant | null) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    category: task.category,
    executionMode: task.executionMode,
    publisher: task.publisher,
    state: task.state,
    evaluation: task.evaluation,
    createdAt: task.createdAt,
    declaredDurationHours: task.declaredDurationHours,
    executorCount: task.executorIds.length,
    maxExecutors: task.maxExecutors,
    executorIds: task.executorIds,
    teamClosed: task.teamClosed,
    workRound: task.workRound,
    testerId: task.testerId,
    criteria: task.criteria,
    completionDefinition: task.completionDefinition,
    requiredTesterCapabilities: task.requiredTesterCapabilities,
    artifact: task.submission ? { artifactHash: task.submission.artifactHash, submittedAt: task.submission.submittedAt, summary: task.submission.summary } : null,
    verification: task.testResult ? {
      passed: task.testResult.passed,
      tester: task.testResult.testerId,
      reportHash: task.testResult.reportHash,
      testsPassed: task.testResult.testsPassed,
      hiddenTestsPassed: task.testResult.hiddenTestsPassed,
      lineCoverage: task.testResult.lineCoverage,
      branchCoverage: task.testResult.branchCoverage,
      criticalBranchCoverage: task.testResult.criticalBranchCoverage,
      executorWeightsBps: task.testResult.executorWeightsBps,
      criterionResults: task.testResult.criterionResults?.map(({ criterionId, verificationType, passed, evidence }) => ({ criterionId, verificationType, passed, evidence })),
    } : null,
    reward: reward ? {
      total: reward.total,
      difficulty: reward.difficulty,
      collaborationMultiplier: reward.collaborationMultiplier,
      issuanceProof: reward.issuanceProof,
      tranches: reward.tranches.map(({ id, label, dueAt, amount, status }) => ({ id, label, dueAt, amount, status })),
    } : null,
    maintenance: { healthy: task.maintenanceHealthy },
    maintenanceRepairCheckpoint: task.maintenanceRepairCheckpoint,
    businessAdoption: task.businessAdoption ? {
      workflowType: task.businessAdoption.workflowType,
      artifactHash: task.businessAdoption.artifactHash,
      workflowEvidenceHash: task.businessAdoption.workflowEvidenceHash,
      adoptedAt: task.businessAdoption.adoptedAt,
      reportHash: task.businessAdoption.reportHash,
    } : null,
  };
}

export function publicCompletedTask(task: Task, reward?: RewardGrant | null) {
  if (task.state !== "COMPLETED") throw new Error("TASK_NOT_COMPLETED");
  return publicTaskView(task, reward);
}

export function publicTaskStatistics(tasks: Task[], rewards: RewardGrant[], now = new Date()) {
  const visible = tasks.filter((task) => task.state !== "EVALUATING" && task.evaluation?.status !== "REJECTED");
  const completed = visible.filter((task) => task.state === "COMPLETED");
  const accepted = visible.filter((task) => task.state === "MAINTENANCE" || task.state === "COMPLETED");
  const settled = tasks.filter((task) => ["COMPLETED", "REJECTED", "DISPUTED"].includes(task.state));
  const cutoff = now.getTime() - 30 * 86_400_000;
  const count = (items: string[]) => Object.fromEntries([...new Set(items)].sort().map((key) => [key, items.filter((item) => item === key).length]));
  return {
    generatedAt: now.toISOString(),
    totalPublishedTasks: visible.length,
    activeTasks: visible.filter((task) => !["COMPLETED", "REJECTED"].includes(task.state)).length,
    acceptedTasks: accepted.length,
    completedTasks: completed.length,
    completedTasksCreatedLast30Days: completed.filter((task) => new Date(task.createdAt).getTime() >= cutoff).length,
    settledCompletionRate: settled.length ? completed.length / settled.length : null,
    independentlyVerifiedTasks: accepted.filter((task) => task.testResult?.passed && task.testResult.reportHash).length,
    businessAdoptionAttestations: completed.filter((task) => task.businessAdoption).length,
    totalIssuedRewards: rewards.reduce((sum, reward) => sum + reward.total, 0),
    completedByCategory: count(completed.map((task) => task.category)),
    completedByExecutionMode: count(completed.map((task) => task.executionMode)),
  };
}
