import type { AgentRole, AgentScope } from "./types";

export const AGENT_ROLES = ["EXECUTOR", "TESTER", "EVALUATOR", "BOTH"] as const satisfies readonly AgentRole[];
export const AGENT_SCOPES = ["tasks:claim", "tasks:submit", "tests:submit", "evaluations:submit", "heartbeat:write"] as const satisfies readonly AgentScope[];

export const AGENT_ROLE_CAPABILITY_MASK: Readonly<Record<AgentRole, number>> = {
  EXECUTOR: 1,
  TESTER: 2,
  EVALUATOR: 4,
  BOTH: 7,
};

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
