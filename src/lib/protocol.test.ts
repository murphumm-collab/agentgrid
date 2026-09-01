import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_CONFIG,
  REWARD_SPLIT_BPS,
  addDays,
  calculateDifficulty,
  collaborationKey,
  collaborationMultiplier,
  consumeTaskCredit,
  issueTaskCredit,
  protocolHash,
  releaseTaskSlot,
  selectRandomTester,
  validateAndCreateReward,
  validateSoftwareEvidence,
} from "./protocol";
import type { Agent, ProtocolConfig, SoftwareEvidence, StakePosition, Task, TestResult } from "./types";

const now = "2026-08-30T00:00:00.000Z";

it("keeps the participant reward split complete and aligned with RewardVault", () => {
  expect(REWARD_SPLIT_BPS).toEqual({ executors: 6_500, tester: 1_500, reserve: 2_000 });
  expect(Object.values(REWARD_SPLIT_BPS).reduce((sum, value) => sum + value, 0)).toBe(10_000);
  const rewardVault = readFileSync(new URL("../../contracts/src/RewardVault.sol", import.meta.url), "utf8");
  expect(rewardVault).toContain("EXECUTOR_BPS = 6_500");
  expect(rewardVault).toContain("TESTER_BPS = 1_500");
});

function position(overrides: Partial<StakePosition> = {}): StakePosition {
  return { id: "position-1", owner: "publisher", amount: 2_000, activeTaskId: "task-1", creditExpiresAt: null, ...overrides };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1", title: "Build useful software", description: "A sufficiently detailed useful software task description.", category: "Development",
    publisher: "publisher", stakePositionId: "position-1", state: "USER_REVIEW", maxExecutors: 2, declaredDurationHours: 48,
    createdAt: now, deadlineAt: addDays(now, 7), executorIds: ["executor-1"], testerId: "tester-1", testerSelectionProof: "sha256:selection",
    criteria: [{ id: "c1", description: "Tests pass" }], submission: { artifactUrl: "https://example.com/a", artifactHash: "sha256:artifact", summary: "done", submittedAt: now },
    testResult: null, rewardGrantId: null, maintenanceHealthy: [false, false, false], ...overrides,
  };
}

function evidence(overrides: Partial<SoftwareEvidence> = {}): SoftwareEvidence {
  return { testsPassed: true, hiddenTestsPassed: true, lineCoverage: 0.9, branchCoverage: 0.85, criticalBranchCoverage: 0.97, artifactHash: "sha256:artifact", ...overrides };
}

function result(overrides: Partial<TestResult> = {}): TestResult {
  return { ...evidence(), testerId: "tester-1", passed: true, failures: [], submittedAt: now, selectionProof: "sha256:selection", ...overrides };
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return { id: "tester-1", name: "Tester", owner: "tester-owner", role: "TESTER", capabilities: ["testing"], endpoint: "https://example.com", apiKey: "key", stake: 500, reputation: 90, completedTasks: 3, online: true, ...overrides };
}

describe("protocol primitives", () => {
  it("produces deterministic protocol hashes and dates", () => {
    expect(protocolHash("a", 1, true)).toBe(protocolHash("a", 1, true));
    expect(protocolHash("a", 1, true)).toMatch(/^sha256:/);
    expect(addDays(now, 7)).toBe("2026-09-06T00:00:00.000Z");
  });

  it("bounds difficulty by unique executors, declared count and time", () => {
    expect(calculateDifficulty(task({ executorIds: [], maxExecutors: 1, declaredDurationHours: 0.1 }))).toBe(1);
    expect(calculateDifficulty(task({ executorIds: ["a", "a", "b"], maxExecutors: 2, declaredDurationHours: 48 }))).toBeGreaterThan(1);
    expect(calculateDifficulty(task({ executorIds: Array.from({ length: 40 }, (_, i) => `e${i}`), maxExecutors: 40, declaredDurationHours: 10_000 }))).toBe(24);
  });
});

describe("stake position and task credit", () => {
  it("issues, consumes and releases one credit", () => {
    const idle = position({ activeTaskId: null, creditExpiresAt: null });
    const credited = issueTaskCredit(idle, now);
    expect(credited.creditExpiresAt).toBe(addDays(now, 30));
    const consumed = consumeTaskCredit(credited, "task-2", now);
    expect(consumed).toMatchObject({ activeTaskId: "task-2", creditExpiresAt: null });
    expect(releaseTaskSlot(consumed, "task-2").activeTaskId).toBeNull();
  });

  it("rejects invalid credit and slot operations", () => {
    expect(() => issueTaskCredit(position(), now)).toThrow("ACTIVE_TASK_EXISTS");
    expect(() => issueTaskCredit(position({ activeTaskId: null, amount: 999 }), now)).toThrow("INSUFFICIENT_STAKE");
    expect(() => issueTaskCredit(position({ activeTaskId: null, creditExpiresAt: addDays(now, 1) }), now)).toThrow("LIVE_CREDIT_EXISTS");
    expect(() => consumeTaskCredit(position(), "task-2", now)).toThrow("ACTIVE_TASK_EXISTS");
    expect(() => consumeTaskCredit(position({ activeTaskId: null }), "task-2", now)).toThrow("TASK_CREDIT_REQUIRED");
    expect(() => consumeTaskCredit(position({ activeTaskId: null, creditExpiresAt: addDays(now, -1) }), "task-2", now)).toThrow("TASK_CREDIT_REQUIRED");
    expect(() => releaseTaskSlot(position(), "wrong")).toThrow("TASK_SLOT_MISMATCH");
  });
});

describe("tester selection and evidence", () => {
  it("selects a deterministic independent eligible tester", () => {
    const agents = [
      agent({ id: "executor-1", role: "BOTH", owner: "executor-owner" }),
      agent({ id: "offline", online: false }),
      agent({ id: "revoked", revokedAt: new Date().toISOString() }),
      agent({ id: "low-stake", stake: 10 }),
      agent({ id: "executor-only", role: "EXECUTOR" }),
      agent({ id: "evaluator-only", role: "EVALUATOR" }),
      agent({ id: "tester-1" }),
      agent({ id: "tester-2", owner: "tester-owner-2" }),
    ];
    const first = selectRandomTester(task(), agents, "randomness");
    const second = selectRandomTester(task(), agents, "randomness");
    expect(first).toEqual(second);
    expect(["tester-1", "tester-2"]).toContain(first.tester.id);
    expect(first.proof).toMatch(/^sha256:/);
  });

  it("rejects a tester owned by publisher and empty pools", () => {
    expect(() => selectRandomTester(task(), [agent({ owner: "publisher" })], "seed")).toThrow("NO_ELIGIBLE_TESTER");
  });

  it("filters random testers by every declared verification speciality", () => {
    const typedTask = task({ requiredTesterCapabilities: ["AUTOMATED_TEST", "DATA_VALIDATION"] });
    const generic = agent({ id: "generic", capabilities: ["AUTOMATED_TEST"] });
    const specialist = agent({ id: "specialist", capabilities: ["AUTOMATED_TEST", "DATA_VALIDATION"] });
    expect(selectRandomTester(typedTask, [generic, specialist], "seed").tester.id).toBe("specialist");
    expect(() => selectRandomTester(typedTask, [generic], "seed")).toThrow("NO_ELIGIBLE_TESTER");
  });

  it("validates all software gates and percentages", () => {
    expect(validateSoftwareEvidence(evidence())).toEqual({ passed: true, failures: [] });
    const failed = validateSoftwareEvidence(evidence({ testsPassed: false, hiddenTestsPassed: false, lineCoverage: 0.84, branchCoverage: 0.79, criticalBranchCoverage: 0.94, artifactHash: "bad" }));
    expect(failed.passed).toBe(false);
    expect(failed.failures).toEqual(["TESTS_FAILED", "HIDDEN_TESTS_FAILED", "LINE_COVERAGE_LOW", "BRANCH_COVERAGE_LOW", "CRITICAL_COVERAGE_LOW", "INVALID_ARTIFACT_HASH"]);
    expect(() => validateSoftwareEvidence(evidence({ lineCoverage: 1.1 }))).toThrow("INVALID_COVERAGE");
    expect(() => validateSoftwareEvidence(evidence({ lineCoverage: -0.1 }))).toThrow("INVALID_COVERAGE");
  });
});

describe("collaboration and reward issuance", () => {
  it("creates stable collaboration keys and decreasing multipliers", () => {
    expect(collaborationKey(task({ executorIds: ["b", "a"] }))).toBe(collaborationKey(task({ executorIds: ["a", "b"] })));
    expect([0, 1, 2, 3, 4, 8].map((count) => collaborationMultiplier(count))).toEqual([1, 0.7, 0.4, 0.2, 0.1, 0.1]);
    expect(() => collaborationMultiplier(-1)).toThrow("INVALID_COLLABORATION_COUNT");
  });

  it("creates a capped, staged, balanced issuance proof", () => {
    const grant = validateAndCreateReward({ task: task(), position: position(), testResult: result(), config: { ...DEFAULT_CONFIG }, priorCollaborationCount: 0, now });
    expect(grant.total).toBe(400);
    expect(grant.tranches.map((item) => item.amount)).toEqual([160, 80, 80, 80]);
    expect(grant.tranches[0].status).toBe("CLAIMABLE");
    expect(grant.tranches[1].status).toBe("LOCKED");
    expect(grant.issuanceProof).toMatch(/^sha256:/);
    expect(grant.tranches.reduce((sum, tranche) => sum + tranche.amount, 0)).toBe(grant.total);
  });

  it("applies repeat decay and rounding correction", () => {
    const custom: ProtocolConfig = { ...DEFAULT_CONFIG, rewardCapRatio: 0.33333, maintenanceShares: [0.3333, 0.2222, 0.2222, 0.2223] };
    const grant = validateAndCreateReward({ task: task(), position: position({ amount: 1_001 }), testResult: result(), config: custom, priorCollaborationCount: 2, now });
    expect(grant.collaborationMultiplier).toBe(0.4);
    expect(grant.tranches.reduce((sum, tranche) => sum + tranche.amount, 0)).toBeCloseTo(grant.total, 8);
  });

  it.each([
    ["duplicate", { existingGrant: {} as never }, "REWARD_ALREADY_ISSUED"],
    ["task grant id", { task: task({ rewardGrantId: "grant" }) }, "REWARD_ALREADY_ISSUED"],
    ["wrong state", { task: task({ state: "TESTING" }) }, "TASK_NOT_REWARD_ELIGIBLE"],
    ["failed test", { testResult: result({ passed: false }) }, "TEST_NOT_PASSED"],
    ["reported failure", { testResult: result({ failures: ["bad"] }) }, "TEST_NOT_PASSED"],
    ["wrong tester", { testResult: result({ testerId: "other" }) }, "TESTER_MISMATCH"],
    ["no tester", { task: task({ testerId: null }) }, "TESTER_MISMATCH"],
    ["tester executor", { task: task({ executorIds: ["tester-1"] }) }, "TESTER_NOT_INDEPENDENT"],
    ["tester publisher", { task: task({ publisher: "tester-1" }) }, "TESTER_NOT_INDEPENDENT"],
    ["bad evidence", { testResult: result({ lineCoverage: 0.1 }) }, "INVALID_TEST_EVIDENCE"],
    ["wrong position", { position: position({ activeTaskId: "other" }) }, "POSITION_TASK_MISMATCH"],
  ])("rejects %s", (_name, overrides, message) => {
    const input = { task: task(), position: position(), testResult: result(), config: { ...DEFAULT_CONFIG }, priorCollaborationCount: 0, now, ...overrides };
    expect(() => validateAndCreateReward(input)).toThrow(message as string);
  });

  it("rejects budget and maintenance misconfiguration", () => {
    const base = { task: task(), position: position(), testResult: result(), priorCollaborationCount: 0, now };
    expect(() => validateAndCreateReward({ ...base, config: { ...DEFAULT_CONFIG, epochRewardBudget: 100 } })).toThrow("EPOCH_BUDGET_EXCEEDED");
    expect(() => validateAndCreateReward({ ...base, config: { ...DEFAULT_CONFIG, maintenanceShares: [1] } })).toThrow("INVALID_MAINTENANCE_CONFIG");
    expect(() => validateAndCreateReward({ ...base, config: { ...DEFAULT_CONFIG, maintenanceShares: [0.1, 0.1, 0.1, 0.1] } })).toThrow("INVALID_MAINTENANCE_SHARES");
    expect(() => validateAndCreateReward({ ...base, position: position({ amount: 0 }), config: { ...DEFAULT_CONFIG } })).toThrow("ZERO_REWARD");
  });
});
