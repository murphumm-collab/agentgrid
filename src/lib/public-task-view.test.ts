import { describe, expect, it } from "vitest";
import { publicCompletedTask, publicTaskStatistics } from "./public-task-view";
import type { RewardGrant, Task } from "./types";

const task = {
  id: "42", title: "Completed service", description: "A public business outcome", category: "Development", executionMode: "COLLABORATION",
  publisher: "0xPublisher", stakePositionId: "7", state: "COMPLETED", maxExecutors: 2, declaredDurationHours: 24,
  createdAt: "2026-01-20T00:00:00.000Z", completedAt: "2026-08-25T00:00:00.000Z", deadlineAt: "2026-08-23T00:00:00.000Z", executorIds: ["0xA", "0xB"],
  testerId: "0xTester", testerSelectionProof: "0xproof", criteria: [{ id: "criterion-1", description: "Tests pass" }],
  submission: { artifactUrl: "https://private.example/signed", artifactHash: "0xartifact", summary: "Delivered", submittedAt: "2026-08-21T00:00:00.000Z" },
  testResult: { testerId: "0xTester", passed: true, failures: [], testsPassed: true, hiddenTestsPassed: true, lineCoverage: 0.95, branchCoverage: 0.96, criticalBranchCoverage: 1, artifactHash: "sha256:artifact", logUrl: "https://private.example/log", submittedAt: "2026-08-21T01:00:00.000Z", selectionProof: "secret-selection", reportHash: "0xreport", executorWeightsBps: [6000, 4000], criterionResults: [{ criterionId: "criterion-1", verificationType: "AUTOMATED_TEST", passed: true, observation: "private implementation detail", evidence: [{ type: "ARTIFACT_HASH", value: `sha256:${"a".repeat(64)}` }] }] },
  rewardGrantId: "grant-1", maintenanceHealthy: [true, true, true],
} satisfies Task;
const reward = { id: "grant-1", taskId: "42", epochId: "epoch", total: 100, difficulty: 1, collaborationMultiplier: 1, issuanceProof: "0xissuance", tranches: [] } satisfies RewardGrant;

describe("public completed task views", () => {
  it("publishes proof and aggregate fields without signed URLs, logs or selection secrets", () => {
    const view = publicCompletedTask(task, reward);
    expect(view.artifact?.artifactHash).toBe("0xartifact");
    expect(JSON.stringify(view)).not.toContain("private.example");
    expect(JSON.stringify(view)).not.toContain("secret-selection");
    expect(JSON.stringify(view)).not.toContain("private implementation detail");
    expect(view.verification?.criterionResults?.[0]).not.toHaveProperty("observation");
    expect(view.verification?.reportHash).toBe("0xreport");
  });

  it("computes honest denominators and category totals", () => {
    const rejected = { ...task, id: "43", state: "REJECTED" as const };
    const stats = publicTaskStatistics([task, rejected], [reward], new Date("2026-08-31T00:00:00.000Z"));
    expect(stats.completedTasks).toBe(1);
    expect(stats.settledCompletionRate).toBe(0.5);
    expect(stats.completedTasksLast30Days).toBe(1);
    expect(stats.completedTasksWithTrustedTimestamp).toBe(1);
    expect(stats.completionTimestampCoverage).toBe(1);
    expect(stats.completedByCategory).toEqual({ Development: 1 });
  });
});
