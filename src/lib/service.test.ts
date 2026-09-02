import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./store";
import {
  authenticateAgent,
  claimReward,
  claimTask,
  completeMaintenance,
  createStakePosition,
  createTask,
  faucet,
  protocolSnapshot,
  registerAgent,
  revokeAgentCredential,
  reviewTask,
  submitTest,
  submitWork,
} from "./service";
import { taskDefinitionVersion } from "./task-definition";
import { createVerificationPlan } from "./verification-panel";

const researchDefinition = {
  version: taskDefinitionVersion, targetUsers: "Risk analysts approving the signed research report", deliverables: ["Deterministic signed research pipeline and report"],
  constraints: ["The same committed input must produce the same output"], outOfScope: ["Production trading decisions and execution"], assumptions: [], aiReviews: [],
  acceptanceCriteria: [
    { id: "criterion-1", description: "The pipeline produces a deterministic signed report", verificationMethod: "Tester executes the pipeline twice with the committed input", evidenceRequired: "Two signed output hashes and execution logs", passCondition: "Both output hashes must be identical", required: true },
    { id: "criterion-2", description: "The report contains every required risk field", verificationMethod: "Tester validates the output against the committed schema", evidenceRequired: "Signed schema validation report", passCondition: "Schema validation must pass with zero missing fields", required: true },
  ],
  verificationPlan: createVerificationPlan(["criterion-1", "criterion-2"]),
};

const artifactHash = "sha256:7b57c8b979c793b5f50791478c1fc5772d49ed80f06c8a32f9f5079e0b07f799";

describe("backend protocol workflow", () => {
  beforeEach(async () => resetDatabase());

  it("runs claim, submit, random test, accept and idempotent reward claim", async () => {
    await authenticateAgent("agent-builder-01", "amp_demo_executor");
    await claimTask("task-demo-001", "agent-builder-01");
    const submitted = await submitWork("task-demo-001", "agent-builder-01", {
      artifactUrl: "https://example.com/a.zip",
      artifactHash,
      summary: "Implemented the complete service with tests and documentation.",
    });
    expect(submitted.task.state).toBe("TESTING");
    expect(submitted.tester.id).not.toBe("agent-builder-01");

    const tested = await submitTest("task-demo-001", submitted.tester.id, {
      testsPassed: true,
      hiddenTestsPassed: true,
      lineCoverage: 0.94,
      branchCoverage: 0.91,
      criticalBranchCoverage: 0.98,
      artifactHash,
    }, submitted.selectionProof);
    expect(tested.state).toBe("USER_REVIEW");

    const accepted = await reviewTask("task-demo-001", "0xDemoPublisher", "ACCEPT");
    expect("grant" in accepted && accepted.grant.total).toBe(200);
    const snapshot = await protocolSnapshot();
    const grant = snapshot.rewards[0];
    const delivery = grant.tranches[0];
    const claimed = await claimReward("task-demo-001", delivery.id);
    expect(claimed.executorTotal).toBe(64);
    expect(claimed.testerAmount).toBe(16);
    await expect(claimReward("task-demo-001", delivery.id)).rejects.toThrow("TRANCHE_NOT_CLAIMABLE");
    await expect(completeMaintenance("task-demo-001", "0xDemoPublisher", 0, true)).rejects.toThrow("CHECKPOINT_NOT_DUE");
  });

  it("makes demo executor weights explicit and pays the executor pool by that exact vector", async () => {
    await claimTask("task-demo-001", "agent-builder-01");
    await claimTask("task-demo-001", "agent-verifier-02");
    const submitted = await submitWork("task-demo-001", "agent-builder-01", {
      artifactUrl: "https://example.com/team.zip", artifactHash,
      summary: "The two-agent demo team delivered one deterministic combined artifact.",
    });
    const tested = await submitTest("task-demo-001", submitted.tester.id, {
      testsPassed: true, hiddenTestsPassed: true, lineCoverage: 0.94,
      branchCoverage: 0.91, criticalBranchCoverage: 0.98, artifactHash,
    }, submitted.selectionProof);
    expect(tested.testResult?.executorWeightsBps).toEqual([5_000, 5_000]);
    await reviewTask("task-demo-001", "0xDemoPublisher", "ACCEPT");
    const snapshot = await protocolSnapshot();
    const claimed = await claimReward("task-demo-001", snapshot.rewards[0].tranches[0].id);
    expect(claimed.executorPayments).toEqual([
      { agentId: "agent-builder-01", weightBps: 5_000, amount: 32 },
      { agentId: "agent-verifier-02", weightBps: 5_000, amount: 32 },
    ]);
    expect(claimed.protocolReserve).toBe(0);
  });

  it("requires agent credentials and structured rejection evidence", async () => {
    await expect(authenticateAgent("agent-builder-01", "wrong")).rejects.toThrow("AGENT_AUTHENTICATION_FAILED");
    await claimTask("task-demo-001", "agent-builder-01");
    const submitted = await submitWork("task-demo-001", "agent-builder-01", {
      artifactUrl: "https://example.com/a.zip", artifactHash, summary: "Completed the requested work and all acceptance criteria.",
    });
    await submitTest("task-demo-001", submitted.tester.id, {
      testsPassed: true, hiddenTestsPassed: true, lineCoverage: 0.9, branchCoverage: 0.85, criticalBranchCoverage: 0.97, artifactHash,
    }, submitted.selectionProof);
    await expect(reviewTask("task-demo-001", "0xDemoPublisher", "REJECT", { code: "SPEC_MISMATCH" })).rejects.toThrow("STRUCTURED_REJECTION_REQUIRED");
    const disputed = await reviewTask("task-demo-001", "0xDemoPublisher", "REJECT", {
      code: "SPEC_MISMATCH", criterionId: "criterion-build", evidenceHash: "sha256:proof", detail: "The first acceptance criterion has a reproducible mismatch.",
    });
    expect(disputed.task.state).toBe("DISPUTED");
  });

  it("registers and claims with a zero-stake executor identity", async () => {
    await expect(registerAgent({
      owner: `0x${"8".repeat(40)}`, name: "Invalid Validator", role: "TESTER",
      capabilities: ["AUTOMATED_TEST"], endpoint: "https://validator.example/jobs",
      stake: 0, stakePositionId: "0",
    })).rejects.toThrow();
    const registration = await registerAgent({
      owner: `0x${"9".repeat(40)}`, name: "Open Executor", role: "EXECUTOR",
      capabilities: ["typescript"], endpoint: "https://executor.example/jobs",
      stake: 0, stakePositionId: "0",
    });
    expect(registration.agent).toMatchObject({ role: "EXECUTOR", stake: 0, stakePositionId: "0" });
    const task = await claimTask("task-demo-001", registration.agent.id);
    expect(task.executorIds).toContain(registration.agent.id);
    const recovered = await registerAgent({
      owner: `0x${"9".repeat(40)}`, name: "Open Executor", role: "EXECUTOR",
      capabilities: ["typescript"], endpoint: "https://executor.example/jobs",
      stake: 0, stakePositionId: "0",
    });
    expect(recovered.recovered).toBe(true);
    expect(recovered.agent.id).toBe(registration.agent.id);
  });

  it("recovers an exact active registration atomically without creating a second identity", async () => {
    const input = {
      owner: `0x${"1".repeat(40)}`, name: "Recovery Agent", role: "EXECUTOR" as const,
      capabilities: ["typescript", "testing"], endpoint: "https://agent.example/jobs",
      stake: 1_500, stakePositionId: "701",
    };
    const first = await registerAgent(input);
    const recovered = await registerAgent(input);
    expect(first.recovered).toBe(false);
    expect(recovered.recovered).toBe(true);
    expect(recovered.agent.id).toBe(first.agent.id);
    expect(recovered.apiKey).not.toBe(first.apiKey);
    await expect(authenticateAgent(first.agent.id, first.apiKey)).rejects.toThrow("AGENT_AUTHENTICATION_FAILED");
    await expect(authenticateAgent(first.agent.id, recovered.apiKey)).resolves.toMatchObject({ id: first.agent.id });
    expect((await protocolSnapshot()).agents.filter((agent) => agent.stakePositionId === input.stakePositionId)).toHaveLength(1);

    await expect(registerAgent({ ...input, endpoint: "https://different.example/jobs" }))
      .rejects.toThrow("AGENT_REGISTRATION_RECOVERY_MISMATCH");
    await expect(registerAgent({ ...input, owner: `0x${"2".repeat(40)}` }))
      .rejects.toThrow("AGENT_STAKE_POSITION_ALREADY_BOUND");
    await revokeAgentCredential(first.agent.id, input.owner);
    await expect(registerAgent(input)).rejects.toThrow("AGENT_REGISTRATION_RECOVERY_INACTIVE");
  });

  it("creates a funded stake position and consumes its only credit", async () => {
    const owner = "0xNewPublisher";
    await faucet(owner, 5_000);
    const { position } = await createStakePosition(owner, 2_000);
    expect(position.creditExpiresAt).not.toBeNull();
    const created = await createTask({
      publisher: owner,
      stakePositionId: position.id,
      title: "Create a maintained risk research pipeline",
      description: "Deliver a useful research pipeline with deterministic outputs and maintain it for the complete lifecycle.",
      category: "Research",
      maxExecutors: 1,
      declaredDurationHours: 24,
      criteria: researchDefinition.acceptanceCriteria.map((item) => item.description), completionDefinition: researchDefinition,
    });
    expect(created.state).toBe("OPEN");
    const snapshot = await protocolSnapshot();
    expect(snapshot.positions.find((item) => item.id === position.id)?.activeTaskId).toBe(created.id);
    await expect(createTask({
      publisher: owner, stakePositionId: position.id, title: "Create another maintained risk pipeline",
      description: "This task should be rejected because the same position already has an active task assigned to it.",
      category: "Research", maxExecutors: 1, declaredDurationHours: 8, criteria: researchDefinition.acceptanceCriteria.map((item) => item.description), completionDefinition: researchDefinition,
    })).rejects.toThrow("ACTIVE_TASK_EXISTS");
  });
});
