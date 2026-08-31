import { describe, expect, it } from "vitest";
import { AGENT_ROLE_CAPABILITY_MASK, AGENT_ROLE_DEFAULT_SCOPES, roleAllowsScope, roleCanLease } from "./agent-roles";

describe("agent role separation", () => {
  it("maps each single-purpose role to exactly one on-chain capability", () => {
    expect(AGENT_ROLE_CAPABILITY_MASK).toEqual({ EXECUTOR: 1, TESTER: 2, EVALUATOR: 4, BOTH: 7 });
  });

  it("keeps tester and evaluator API scopes independent", () => {
    expect(AGENT_ROLE_DEFAULT_SCOPES.TESTER).toEqual(["tests:submit", "heartbeat:write"]);
    expect(AGENT_ROLE_DEFAULT_SCOPES.EVALUATOR).toEqual(["evaluations:submit", "heartbeat:write"]);
    expect(AGENT_ROLE_DEFAULT_SCOPES.TESTER).not.toContain("evaluations:submit");
    expect(AGENT_ROLE_DEFAULT_SCOPES.EVALUATOR).not.toContain("tests:submit");
    expect(roleAllowsScope("TESTER", "tests:submit")).toBe(true);
    expect(roleAllowsScope("TESTER", "evaluations:submit")).toBe(false);
    expect(roleAllowsScope("EVALUATOR", "evaluations:submit")).toBe(true);
    expect(roleAllowsScope("EVALUATOR", "tests:submit")).toBe(false);
  });

  it("allows only a matching role or explicit BOTH role to lease a queue", () => {
    expect(roleCanLease("EVALUATOR", "EVALUATOR")).toBe(true);
    expect(roleCanLease("TESTER", "EVALUATOR")).toBe(false);
    expect(roleCanLease("EVALUATOR", "TESTER")).toBe(false);
    expect(roleCanLease("BOTH", "EXECUTOR")).toBe(true);
    expect(roleCanLease("BOTH", "TESTER")).toBe(true);
    expect(roleCanLease("BOTH", "EVALUATOR")).toBe(true);
  });
});
