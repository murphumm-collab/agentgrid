import { describe, expect, it } from "vitest";
import type { AgentJob } from "./agent-job-schema";
import {
  chooseSchedulingLane,
  compareSchedulingBindings,
  initialPaidSchedulingState,
  isTargetedExecutorJob,
  isUntargetedExecuteTask,
  recordSuccessfulLease,
  schedulingLaneForJob,
  type SchedulingBinding,
} from "./paid-scheduling";

const now = "2026-09-02T00:00:00.000Z";
const address = `0x${"1".repeat(40)}`;
const attestationHash = `0x${"a".repeat(64)}` as const;
const standard = { schedulingClass: "STANDARD", schedulingAttestationHash: null } as const;
const priority = { schedulingClass: "PRIORITY_SCHEDULING", schedulingAttestationHash: attestationHash } as const;

const job = <T extends AgentJob>(value: T) => value;
const execute = job({ id: "execute", role: "EXECUTOR", kind: "EXECUTE_TASK", payload: { taskId: "1", slot: 1, executorSlots: 2 }, createdAt: now });
const targeted = job({ id: "revise", role: "EXECUTOR", kind: "REVISE_TASK", payload: { taskId: "1", executor: address }, createdAt: now });
const tester = job({ id: "test", role: "TESTER", kind: "TEST_TASK", payload: { taskId: "1", tester: address, shard: 0 }, createdAt: now });
const evaluator = job({ id: "evaluate", role: "EVALUATOR", kind: "EVALUATE_TASK", payload: { taskId: "1", tester: address }, createdAt: now });
const coordinator = job({ id: "coordinate", role: "COORDINATOR", kind: "ASSIGN_TESTER", payload: { taskId: "1" }, createdAt: now });

describe("paid scheduling eligibility and recovery", () => {
  it("allows only untargeted EXECUTE_TASK jobs in the priority lane", () => {
    expect(isUntargetedExecuteTask(execute)).toBe(true);
    expect(schedulingLaneForJob(execute, priority)).toBe("PRIORITY");
    for (const ineligible of [targeted, tester, evaluator, coordinator]) {
      expect(isUntargetedExecuteTask(ineligible)).toBe(false);
      expect(() => schedulingLaneForJob(ineligible, priority)).toThrow("PRIORITY_SCHEDULING_JOB_INELIGIBLE");
    }
  });

  it("restores targeted executor work ahead of the general lanes without upgrading other roles", () => {
    expect(isTargetedExecutorJob(targeted)).toBe(true);
    expect(schedulingLaneForJob(targeted, standard)).toBe("TARGETED_EXECUTOR");
    expect(schedulingLaneForJob(execute, standard)).toBe("STANDARD");
    expect(schedulingLaneForJob(tester, standard)).toBe("STANDARD");
    expect(schedulingLaneForJob(evaluator, standard)).toBe("STANDARD");
    expect(schedulingLaneForJob(coordinator, standard)).toBe("STANDARD");
  });

  it("rejects malformed bindings and detects job-id scheduling replay conflicts", () => {
    expect(compareSchedulingBindings(priority, { ...priority, schedulingAttestationHash: attestationHash.toUpperCase().replace("0X", "0x") as `0x${string}` })).toBe("IDENTICAL");
    expect(compareSchedulingBindings(standard, priority)).toBe("CONFLICT");
    expect(compareSchedulingBindings(priority, { ...priority, schedulingAttestationHash: `0x${"b".repeat(64)}` })).toBe("CONFLICT");
    expect(() => compareSchedulingBindings(
      { schedulingClass: "STANDARD", schedulingAttestationHash: attestationHash } as SchedulingBinding,
      standard,
    )).toThrow("STANDARD_SCHEDULING_ATTESTATION_FORBIDDEN");
    expect(() => schedulingLaneForJob(execute, { schedulingClass: "PRIORITY_SCHEDULING", schedulingAttestationHash: null })).toThrow("PRIORITY_SCHEDULING_ATTESTATION_REQUIRED");
  });
});

describe("paid scheduling 3:1 fairness", () => {
  it("serves at most three priority leases before a waiting standard lease", () => {
    let state = initialPaidSchedulingState();
    const lanes = [];
    for (let index = 0; index < 8; index += 1) {
      const lane = chooseSchedulingLane(state, { targetedExecutor: false, priority: true, standard: true });
      lanes.push(lane);
      state = recordSuccessfulLease(state, lane!);
    }
    expect(lanes).toEqual(["PRIORITY", "PRIORITY", "PRIORITY", "STANDARD", "PRIORITY", "PRIORITY", "PRIORITY", "STANDARD"]);
  });

  it("takes the non-empty lane and forces standard when it appears after a priority-only run", () => {
    let state = initialPaidSchedulingState();
    for (let index = 0; index < 5; index += 1) {
      expect(chooseSchedulingLane(state, { targetedExecutor: false, priority: true, standard: false })).toBe("PRIORITY");
      state = recordSuccessfulLease(state, "PRIORITY");
    }
    expect(state.consecutivePriorityLeases).toBe(3);
    expect(chooseSchedulingLane(state, { targetedExecutor: false, priority: true, standard: true })).toBe("STANDARD");
    expect(chooseSchedulingLane(state, { targetedExecutor: false, priority: false, standard: true })).toBe("STANDARD");
    expect(chooseSchedulingLane(state, { targetedExecutor: false, priority: false, standard: false })).toBeNull();
  });

  it("does not advance for a proposal or targeted lease, and resets only after a successful standard lease", () => {
    const state = { consecutivePriorityLeases: 2 };
    expect(chooseSchedulingLane(state, { targetedExecutor: true, priority: true, standard: true })).toBe("TARGETED_EXECUTOR");
    expect(state).toEqual({ consecutivePriorityLeases: 2 });
    expect(recordSuccessfulLease(state, "TARGETED_EXECUTOR")).toEqual(state);
    expect(chooseSchedulingLane(state, { targetedExecutor: false, priority: true, standard: true })).toBe("PRIORITY");
    expect(state).toEqual({ consecutivePriorityLeases: 2 });
    expect(recordSuccessfulLease(state, "PRIORITY")).toEqual({ consecutivePriorityLeases: 3 });
    expect(recordSuccessfulLease(state, "STANDARD")).toEqual({ consecutivePriorityLeases: 0 });
  });

  it("fails closed for corrupted persisted fairness state", () => {
    expect(() => chooseSchedulingLane({ consecutivePriorityLeases: -1 }, { targetedExecutor: false, priority: true, standard: true })).toThrow("PRIORITY_SCHEDULING_STATE_INVALID");
    expect(() => recordSuccessfulLease({ consecutivePriorityLeases: 4 }, "STANDARD")).toThrow("PRIORITY_SCHEDULING_STATE_INVALID");
  });
});
