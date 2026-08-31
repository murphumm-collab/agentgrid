import { describe, expect, it } from "vitest";
import { AGENT_ROLE_CAPABILITY_MASK, AGENT_ROLE_DEFAULT_SCOPES, agentCapabilityMask, requiredTesterCapabilityMask, roleAllowsScope, roleCanLease } from "./agent-roles";
import { taskDefinitionSchema, taskDefinitionVersion } from "./task-definition";

describe("agent role separation", () => {
  it("maps each single-purpose role to exactly one on-chain capability", () => {
    expect(AGENT_ROLE_CAPABILITY_MASK).toEqual({ EXECUTOR: 1, TESTER: 2, EVALUATOR: 4, BOTH: 7 });
  });

  it("commits verifier specialities without granting unrelated roles", () => {
    expect(agentCapabilityMask("TESTER", ["AUTOMATED_TEST", "DATA_VALIDATION"])).toBe(42);
    expect(agentCapabilityMask("EXECUTOR", ["HUMAN_REVIEW"])).toBe(1);
    const definition = taskDefinitionSchema.parse({
      version: taskDefinitionVersion,
      targetUsers: "The operations owner approving this delivery",
      deliverables: ["A deployable service"], constraints: ["No production secrets"], outOfScope: ["Mainnet deployment"],
      acceptanceCriteria: [
        { id: "criterion-1", description: "Automated suite passes", verificationMethod: "Run sealed tests", evidenceRequired: "Signed manifest hash", passCondition: "Zero failures", verificationType: "AUTOMATED_TEST", required: true },
        { id: "criterion-2", description: "Output dataset is valid", verificationMethod: "Validate schema", evidenceRequired: "Signed dataset hash", passCondition: "Zero invalid rows", verificationType: "DATA_VALIDATION", required: true },
      ], aiReviews: [],
    });
    expect(requiredTesterCapabilityMask(definition)).toBe(42);
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
