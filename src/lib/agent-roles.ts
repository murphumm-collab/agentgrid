import type { AgentRole, AgentScope } from "./types";
import type { TaskDefinition, VerificationType } from "./task-definition";

export const AGENT_ROLES = ["EXECUTOR", "TESTER", "EVALUATOR", "BOTH"] as const satisfies readonly AgentRole[];
export const AGENT_SCOPES = ["tasks:claim", "tasks:submit", "tests:submit", "evaluations:submit", "heartbeat:write"] as const satisfies readonly AgentScope[];

export const AGENT_ROLE_CAPABILITY_MASK: Readonly<Record<AgentRole, number>> = {
  EXECUTOR: 1,
  TESTER: 2,
  EVALUATOR: 4,
  BOTH: 7,
};

export const TESTER_VERIFICATION_CAPABILITY_MASK: Readonly<Record<VerificationType, number>> = {
  AUTOMATED_TEST: 8,
  ARTIFACT_INSPECTION: 16,
  DATA_VALIDATION: 32,
  EXTERNAL_OBSERVATION: 64,
  HUMAN_REVIEW: 128,
};

export function agentCapabilityMask(role: AgentRole, verificationCapabilities: readonly VerificationType[] = []) {
  const base = AGENT_ROLE_CAPABILITY_MASK[role];
  if (role !== "TESTER" && role !== "BOTH") return base;
  return verificationCapabilities.reduce((mask, capability) => mask | TESTER_VERIFICATION_CAPABILITY_MASK[capability], base);
}

export function requiredTesterCapabilityMask(definition: TaskDefinition) {
  return definition.acceptanceCriteria.reduce(
    (mask, criterion) => mask | TESTER_VERIFICATION_CAPABILITY_MASK[criterion.verificationType],
    AGENT_ROLE_CAPABILITY_MASK.TESTER,
  );
}

export const AGENT_ROLE_DEFAULT_SCOPES: Readonly<Record<AgentRole, readonly AgentScope[]>> = {
  EXECUTOR: ["tasks:claim", "tasks:submit", "heartbeat:write"],
  TESTER: ["tests:submit", "heartbeat:write"],
  EVALUATOR: ["evaluations:submit", "heartbeat:write"],
  BOTH: ["tasks:claim", "tasks:submit", "tests:submit", "evaluations:submit", "heartbeat:write"],
};

export type LeasableAgentRole = Exclude<AgentRole, "BOTH">;

export function roleCanLease(registeredRole: AgentRole, requestedRole: LeasableAgentRole): boolean {
  return registeredRole === "BOTH" || registeredRole === requestedRole;
}

export function roleAllowsScope(role: AgentRole, scope: AgentScope): boolean {
  return AGENT_ROLE_DEFAULT_SCOPES[role].includes(scope);
}
