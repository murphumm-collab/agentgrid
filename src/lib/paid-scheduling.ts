import type { AgentJob } from "./agent-job-schema";

export const paidSchedulingClass = "PRIORITY_SCHEDULING" as const;
export const standardSchedulingClass = "STANDARD" as const;
export const maximumConsecutivePriorityLeases = 3 as const;

export type SchedulingClass = typeof standardSchedulingClass | typeof paidSchedulingClass;
export type SchedulingLane = "TARGETED_EXECUTOR" | "PRIORITY" | "STANDARD";

export interface SchedulingBinding {
  schedulingClass: SchedulingClass;
  schedulingAttestationHash: `0x${string}` | null;
}

export interface PaidSchedulingState {
  consecutivePriorityLeases: number;
}

export interface SchedulingAvailability {
  targetedExecutor: boolean;
  priority: boolean;
  standard: boolean;
}

export type SchedulingBindingComparison = "IDENTICAL" | "CONFLICT";

const attestationHashPattern = /^0x[0-9a-fA-F]{64}$/;

export const initialPaidSchedulingState = (): PaidSchedulingState => ({ consecutivePriorityLeases: 0 });

function validatedState(state: PaidSchedulingState) {
  if (!Number.isInteger(state.consecutivePriorityLeases)
    || state.consecutivePriorityLeases < 0
    || state.consecutivePriorityLeases > maximumConsecutivePriorityLeases) {
    throw new Error("PRIORITY_SCHEDULING_STATE_INVALID");
  }
  return state;
}

export function validateSchedulingBinding(binding: SchedulingBinding): SchedulingBinding {
  if (binding.schedulingClass === standardSchedulingClass) {
    if (binding.schedulingAttestationHash !== null) throw new Error("STANDARD_SCHEDULING_ATTESTATION_FORBIDDEN");
    return binding;
  }
  if (!binding.schedulingAttestationHash || !attestationHashPattern.test(binding.schedulingAttestationHash)) {
    throw new Error("PRIORITY_SCHEDULING_ATTESTATION_REQUIRED");
  }
  return binding;
}

export function isUntargetedExecuteTask(job: AgentJob) {
  return job.role === "EXECUTOR" && job.kind === "EXECUTE_TASK" && !("executor" in job.payload);
}

export function isTargetedExecutorJob(job: AgentJob) {
  return job.role === "EXECUTOR" && "executor" in job.payload;
}

/**
 * Resolves the immutable lane recorded when a job was first enqueued. Recovery
 * must call this with the stored binding instead of re-evaluating a commercial
 * entitlement, so an expired lease returns to its original lane.
 */
export function schedulingLaneForJob(job: AgentJob, storedBinding: SchedulingBinding): SchedulingLane {
  const binding = validateSchedulingBinding(storedBinding);
  if (binding.schedulingClass === paidSchedulingClass) {
    if (!isUntargetedExecuteTask(job)) throw new Error("PRIORITY_SCHEDULING_JOB_INELIGIBLE");
    return "PRIORITY";
  }
  return isTargetedExecutorJob(job) ? "TARGETED_EXECUTOR" : "STANDARD";
}

/** Detects replay attempts that reuse a job id with different scheduling data. */
export function compareSchedulingBindings(existing: SchedulingBinding, incoming: SchedulingBinding): SchedulingBindingComparison {
  const left = validateSchedulingBinding(existing);
  const right = validateSchedulingBinding(incoming);
  return left.schedulingClass === right.schedulingClass
    && left.schedulingAttestationHash?.toLowerCase() === right.schedulingAttestationHash?.toLowerCase()
    ? "IDENTICAL"
    : "CONFLICT";
}

/**
 * Chooses a lane without mutating fairness state. A caller advances the state
 * only after it has atomically established the lease.
 */
export function chooseSchedulingLane(state: PaidSchedulingState, availability: SchedulingAvailability): SchedulingLane | null {
  const current = validatedState(state);
  if (availability.targetedExecutor) return "TARGETED_EXECUTOR";
  if (availability.priority && availability.standard) {
    return current.consecutivePriorityLeases >= maximumConsecutivePriorityLeases ? "STANDARD" : "PRIORITY";
  }
  if (availability.priority) return "PRIORITY";
  if (availability.standard) return "STANDARD";
  return null;
}

/** Records one successful lease; failed/empty lease attempts must not call it. */
export function recordSuccessfulLease(state: PaidSchedulingState, lane: SchedulingLane): PaidSchedulingState {
  const current = validatedState(state);
  if (lane === "TARGETED_EXECUTOR") return current;
  if (lane === "STANDARD") return initialPaidSchedulingState();
  return {
    consecutivePriorityLeases: Math.min(maximumConsecutivePriorityLeases, current.consecutivePriorityLeases + 1),
  };
}
