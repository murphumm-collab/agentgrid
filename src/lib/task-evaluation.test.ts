import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { deterministicTaskEvaluation, taskEvaluationMessage, verifyTaskEvaluationSignature } from "./task-evaluation";
import { taskDefinitionVersion } from "./task-definition";

const key = `0x${"31".repeat(32)}` as const;
const completionDefinition = {
  version: taskDefinitionVersion, targetUsers: "Settlement operations analysts approving alerts", deliverables: ["Runnable alerting service"],
  constraints: ["No outbound network while hidden tests run"], outOfScope: ["Production credential provisioning"], assumptions: [], aiReviews: [],
  acceptanceCriteria: [
    { id: "criterion-1", description: "All public and hidden tests pass", verificationMethod: "Random tester runs the sealed suite", evidenceRequired: "Signed test report", passCondition: "All tests must pass with zero failures", required: true },
    { id: "criterion-2", description: "Critical branch coverage is at least 95%", verificationMethod: "Tester measures coverage", evidenceRequired: "Signed coverage report", passCondition: "Coverage must be at least 95%", required: true },
    { id: "criterion-3", description: "Alert latency remains below 500ms", verificationMethod: "Tester replays fixed events", evidenceRequired: "Signed latency trace", passCondition: "p95 latency must be below 500ms", required: true },
  ],
};

describe("task evaluation evidence", () => {
  it("produces a bounded, independently testable recommendation", () => {
    const report = deterministicTaskEvaluation({
      title: "Production anomaly detector", description: "A production service that detects anomalous settlement events and emits deterministic alerts for an operations workflow.",
      category: "Development", maxExecutors: 3, declaredDurationHours: 48, requestedReward: 5_000,
      criteria: ["All public and hidden tests pass", "Critical branch coverage is at least 95%", "Alert latency remains below 500ms"],
      completionDefinition,
    });
    expect(report.approve).toBe(true);
    expect(report.recommendedReward).toBeLessThanOrEqual(5_000);
    expect(report.testabilityBps).toBeGreaterThanOrEqual(5_000);
  });

  it("rejects underspecified work and verifies the evaluator wallet signature", async () => {
    const report = deterministicTaskEvaluation({
      title: "Vague task", description: "Do a useful thing but the intended business result is still unknown.", category: "Research",
      maxExecutors: 1, declaredDurationHours: 8, requestedReward: 100, criteria: ["Make it useful"],
    });
    expect(report.approve).toBe(false);
    const account = privateKeyToAccount(key);
    const commitment = taskEvaluationMessage({ taskId: "19", report });
    const signature = await account.signMessage({ message: commitment.message });
    await expect(verifyTaskEvaluationSignature({ taskId: "19", report, signature, expectedAddress: account.address })).resolves.toMatchObject({ reportHash: commitment.reportHash, signer: account.address });
    await expect(verifyTaskEvaluationSignature({ taskId: "20", report, signature, expectedAddress: account.address })).rejects.toThrow("TASK_EVALUATION_SIGNATURE_INVALID");
  });
});
