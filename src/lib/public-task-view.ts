import type { RewardGrant, Task } from "./types";

export function isPublicTask(task: Task) {
  return task.state !== "EVALUATING"
    && task.state !== "REJECTED"
    && (!task.evaluation || task.evaluation.status === "APPROVED");
}

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
    publishedAt: task.publishedAt,
    completedAt: task.completedAt,
    declaredDurationHours: task.declaredDurationHours,
    executorCount: task.executorIds.length,
    maxExecutors: task.maxExecutors,
    executorIds: task.executorIds,
    teamClosed: task.teamClosed,
    workRound: task.workRound,
    testerId: task.testerId,
    testerIds: task.testerIds ?? (task.testerId ? [task.testerId] : []),
    executorQualityMultipliersBps: task.executorQualityMultipliersBps,
    criteria: task.criteria,
    completionDefinition: task.completionDefinition,
    requiredTesterCapabilities: task.requiredTesterCapabilities,
    artifact: task.submission ? { artifactHash: task.submission.artifactHash, submittedAt: task.submission.submittedAt, summary: task.submission.summary } : null,
    verification: task.testResult ? {
      passed: task.testResult.passed,
      tester: task.testResult.testerId,
      testerIds: task.testResult.testerIds,
      reportHash: task.testResult.reportHash,
      aggregateEvidenceHash: task.testResult.aggregateEvidenceHash ?? task.testResult.reportHash,
      reportHashes: task.testResult.reportHashes,
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
    economics: task.economics ? {
      sourceId: task.economics.sourceId,
      sourceRecipient: task.economics.sourceRecipient,
      fallbackToDao: task.economics.fallbackToDao,
      grossReward: task.economics.grossReward ?? null,
      agentPool: task.economics.agentPool ?? null,
      daoReward: task.economics.daoReward ?? null,
      sourceReward: task.economics.sourceReward ?? null,
      lifecycleCharges: task.economics.lifecycleCharges,
      vestings: task.economics.vestings,
    } : null,
    promotion: task.promotion ?? null,
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
  if (!isPublicTask(task)) throw new Error("TASK_NOT_PUBLIC");
  return publicTaskView(task, reward);
}

export function publicTaskStatistics(tasks: Task[], rewards: RewardGrant[], now = new Date()) {
  const visible = tasks.filter(isPublicTask);
  const completed = visible.filter((task) => task.state === "COMPLETED");
  const accepted = visible.filter((task) => task.state === "MAINTENANCE" || task.state === "COMPLETED");
  const settled = tasks.filter((task) => ["COMPLETED", "REJECTED", "DISPUTED"].includes(task.state));
  const cutoff = now.getTime() - 30 * 86_400_000;
  const completedWithTrustedTimestamp = completed.filter((task) => task.completedAt && Number.isFinite(new Date(task.completedAt).getTime()));
  const count = (items: string[]) => Object.fromEntries([...new Set(items)].sort().map((key) => [key, items.filter((item) => item === key).length]));
  return {
    generatedAt: now.toISOString(),
    totalPublishedTasks: visible.length,
    activeTasks: visible.filter((task) => !["COMPLETED", "REJECTED"].includes(task.state)).length,
    acceptedTasks: accepted.length,
    completedTasks: completed.length,
    completedTasksLast30Days: completedWithTrustedTimestamp.filter((task) => new Date(task.completedAt!).getTime() >= cutoff).length,
    completedTasksWithTrustedTimestamp: completedWithTrustedTimestamp.length,
    completionTimestampCoverage: completed.length ? completedWithTrustedTimestamp.length / completed.length : null,
    settledCompletionRate: settled.length ? completed.length / settled.length : null,
    independentlyVerifiedTasks: accepted.filter((task) => task.testResult?.passed && task.testResult.reportHash).length,
    businessAdoptionAttestations: completed.filter((task) => task.businessAdoption).length,
    totalIssuedRewards: rewards.reduce((sum, reward) => sum + reward.total, 0),
    completedByCategory: count(completed.map((task) => task.category)),
    completedByExecutionMode: count(completed.map((task) => task.executionMode)),
  };
}
