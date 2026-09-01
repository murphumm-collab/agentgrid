import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentJobCompletionSchemas, agentJobKinds, agentJobSchema, agentJobSchemas, parseAgentJobCompletionResult } from "./agent-job-schema";

const now = "2026-09-01T00:00:00.000Z";
const address = `0x${"1".repeat(40)}`;
const hash = `0x${"2".repeat(64)}`;
const provenance = { chainId: 97, transactionHash: hash, logIndex: 1, blockNumber: "42" };
const artifactHash = `sha256:${"3".repeat(64)}`;

const validJobs = [
  { id: "job:execute", role: "EXECUTOR", kind: "EXECUTE_TASK", payload: { taskId: "1", slot: 1, executorSlots: 2, ...provenance }, createdAt: now },
  { id: "job:revise", role: "EXECUTOR", kind: "REVISE_TASK", payload: { taskId: "2", executor: address, ...provenance }, createdAt: now },
  { id: "job:repair", role: "EXECUTOR", kind: "REPAIR_MAINTENANCE", payload: { taskId: "3", executor: address, checkpoint: 1, evidenceHash: hash, ...provenance }, createdAt: now },
  { id: "job:assemble", role: "EXECUTOR", kind: "ASSEMBLE_TASK", payload: { taskId: "4", executor: address, ...provenance }, createdAt: now },
  { id: "job:test", role: "TESTER", kind: "TEST_TASK", payload: { taskId: "5", tester: address, shard: 0, ...provenance }, createdAt: now },
  { id: "job:reveal", role: "TESTER", kind: "REVEAL_TEST_SHARD", payload: {
    taskId: "5", tester: address, shard: 0, workRound: 1, checkpoint: 0, panelEpoch: 1,
    reportHash: hash, evidenceHash: hash, criterionPassMask: 3, winner: address,
    selectedArtifactHash: hash, executorWeightsBps: [10_000], salt: hash, passed: true, ...provenance,
  }, createdAt: now },
  { id: "job:evaluate", role: "EVALUATOR", kind: "EVALUATE_TASK", payload: { taskId: "7", tester: address, ...provenance }, createdAt: now },
  { id: "job:panel", role: "COORDINATOR", kind: "FINALIZE_EVALUATION_PANEL", payload: { taskId: "8", selectionBlock: "100", deadline: "1800000000", ...provenance }, createdAt: now },
  ...["FINALIZE_TASK_EVALUATION", "ASSIGN_TESTER", "FINALIZE_TESTER"].map((kind, index) => ({
    id: `job:coordinator:${index}`, role: "COORDINATOR", kind, payload: { taskId: String(index + 9), ...provenance }, createdAt: now,
  })),
  { id: "job:maintenance-panel", role: "COORDINATOR", kind: "START_MAINTENANCE_PANEL", payload: { taskId: "12", checkpoint: 1, dueAt: "1800000000" }, createdAt: now },
  { id: "job:finalize-verification", role: "COORDINATOR", kind: "FINALIZE_VERIFICATION_PANEL", payload: { taskId: "13", panelEpoch: 2, dueAt: "1800000000" }, createdAt: now },
  { id: "job:expire-verification", role: "COORDINATOR", kind: "EXPIRE_VERIFICATION_PANEL", payload: { taskId: "14", panelEpoch: 3, dueAt: "1800000000" }, createdAt: now },
  { id: "job:expire-arbitration", role: "COORDINATOR", kind: "EXPIRE_VERIFICATION_ARBITRATION", payload: { taskId: "15", caseId: hash, dueAt: "1800000000" }, createdAt: now },
];

const validCompletionResults = {
  EXECUTE_TASK: { artifactHash, transactionHash: hash },
  REVISE_TASK: { artifactHash, contributionTransactionHash: hash, slot: 1 },
  REPAIR_MAINTENANCE: { artifactHash, transactionHash: hash },
  ASSEMBLE_TASK: { artifactHash, transactionHash: hash, contributions: 2 },
  TEST_TASK: { reportHash: hash, evidenceHash: hash, transactionHash: hash, passed: true },
  REVEAL_TEST_SHARD: { reportHash: hash, evidenceHash: hash, alreadyRevealed: true, passed: true },
  EVALUATE_TASK: { reportHash: hash, alreadySubmitted: true, approve: true },
  FINALIZE_EVALUATION_PANEL: { phase: "finalizeEvaluationPanel", alreadyFinalized: true },
  FINALIZE_TASK_EVALUATION: { phase: "finalizeTaskEvaluation", transactionHash: hash },
  ASSIGN_TESTER: { phase: "requestTester", transactionHash: hash },
  FINALIZE_TESTER: { phase: "finalizeTester", transactionHash: hash },
  START_MAINTENANCE_PANEL: { phase: "requestMaintenancePanel", alreadyFinalized: true },
  FINALIZE_VERIFICATION_PANEL: { phase: "finalizeVerificationPanel", transactionHash: hash },
  EXPIRE_VERIFICATION_PANEL: { phase: "expireVerificationPanel", transactionHash: hash },
  EXPIRE_VERIFICATION_ARBITRATION: { phase: "expireVerificationArbitration", alreadyFinalized: true },
} as const;

describe("Agent queue job contracts", () => {
  it("accepts every supported exact role/kind/payload contract", () => {
    expect(validJobs).toHaveLength(agentJobKinds.length);
    for (const value of validJobs) expect(agentJobSchema.parse(value)).toEqual(value);
  });

  it("rejects unknown kinds, role drift, incomplete provenance and payload extensions", () => {
    expect(agentJobSchema.safeParse({ ...validJobs[0], kind: "UNKNOWN" }).success).toBe(false);
    expect(agentJobSchema.safeParse({ ...validJobs[0], role: "TESTER" }).success).toBe(false);
    expect(agentJobSchema.safeParse({ ...validJobs[0], payload: { taskId: "1", chainId: 97 } }).success).toBe(false);
    expect(agentJobSchema.safeParse({ ...validJobs[0], payload: { taskId: "1", unexpected: true } }).success).toBe(false);
    expect(agentJobSchema.safeParse({ ...validJobs[0], payload: { taskId: "0" } }).success).toBe(false);
    expect(agentJobSchema.safeParse({ id: "legacy-maintenance", role: "TESTER", kind: "MAINTENANCE_VALIDATION", payload: { taskId: "6", tester: address, checkpoint: 2, dueAt: "1800000000" }, createdAt: now }).success).toBe(false);
  });

  it("accepts every exact kind-specific completion result and rejects guessing or cross-kind output", () => {
    expect(Object.keys(validCompletionResults).sort()).toEqual([...agentJobKinds].sort());
    for (const kind of agentJobKinds) {
      expect(parseAgentJobCompletionResult(kind, validCompletionResults[kind])).toEqual(validCompletionResults[kind]);
      expect(() => parseAgentJobCompletionResult(kind, { ...validCompletionResults[kind], unexpected: true })).toThrow();
    }
    expect(() => parseAgentJobCompletionResult("ASSEMBLE_TASK", validCompletionResults.EXECUTE_TASK)).toThrow();
    expect(() => parseAgentJobCompletionResult("EXECUTE_TASK", { artifactHash })).toThrow();
    expect(() => parseAgentJobCompletionResult("EVALUATE_TASK", { reportHash: hash, approve: true })).toThrow();
    expect(() => parseAgentJobCompletionResult("FINALIZE_EVALUATION_PANEL", { phase: "requestTester", transactionHash: hash })).toThrow();
  });

  it("binds every runtime kind to an exact OpenAPI payload and role mapping", () => {
    const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8"));
    expect(openapi.info.version).toBe("0.8.0");
    const job = openapi.components.schemas.AgentJob;
    expect(job.additionalProperties).toBe(false);
    expect(job.properties.kind.enum).toEqual(agentJobKinds);
    expect(Object.keys(job["x-agentgrid-kind-payload"]).sort()).toEqual([...agentJobKinds].sort());
    expect(Object.keys(job["x-agentgrid-kind-role"]).sort()).toEqual([...agentJobKinds].sort());
    for (const kind of agentJobKinds) {
      expect(job["x-agentgrid-kind-role"][kind]).toBe(agentJobSchemas[kind].shape.role.value);
      const payloadName = job["x-agentgrid-kind-payload"][kind].replace("#/components/schemas/", "");
      const payload = openapi.components.schemas[payloadName];
      expect(payload).toBeTruthy();
      expect(payload.unevaluatedProperties ?? payload.additionalProperties).toBe(false);
    }
    const completion = openapi.components.schemas.AgentJobCompletionResult;
    expect(Object.keys(completion["x-agentgrid-kind-result"]).sort()).toEqual([...agentJobKinds].sort());
    for (const kind of agentJobKinds) {
      const resultName = completion["x-agentgrid-kind-result"][kind].replace("#/components/schemas/", "");
      expect(openapi.components.schemas[resultName]).toBeTruthy();
      expect(agentJobCompletionSchemas[kind]).toBeTruthy();
    }
  });
});
