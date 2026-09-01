import { describe, expect, it } from "vitest";
import { taskSpecHash, taskSpecSchema } from "./task-commitment";
import { taskDefinitionVersion } from "./task-definition";
import { createVerificationPlan } from "./verification-panel";

const completionDefinition = {
  version: taskDefinitionVersion, targetUsers: "Operations analysts approving the deployed service",
  deliverables: ["Runnable monitored service and operator runbook"], constraints: ["No outbound network during independent tests"],
  outOfScope: ["Mainnet deployment and post-publication scope changes"], assumptions: [], aiReviews: [],
  acceptanceCriteria: [
    { id: "criterion-1", description: "Tests pass", verificationMethod: "Random tester runs the sealed test suite", evidenceRequired: "Signed test log and artifact hash", passCondition: "All tests must pass with zero failures", required: true },
    { id: "criterion-2", description: "Service builds without errors", verificationMethod: "Random tester executes the production build", evidenceRequired: "Signed build log", passCondition: "Build exit code must equal 0", required: true },
  ],
  verificationPlan: createVerificationPlan(["criterion-1", "criterion-2"]),
};

const collaborativeDefinition = {
  ...completionDefinition,
  collaborationPlan: {
    workPackages: completionDefinition.acceptanceCriteria.map((criterion, index) => ({
      slot: index + 1, title: `Workstream ${index + 1}`, objective: `Own the independently runnable implementation for ${criterion.id}`,
      deliverables: [`Runnable contribution and handoff evidence for ${criterion.id}`], dependsOn: [], criterionIds: [criterion.id],
    })),
    sharedInterfaces: ["Every contribution uses repository-relative paths and documents exported interfaces"],
    assemblyStrategy: "The lead integrates every committed contribution and resolves all documented interface conflicts",
    underfilledStrategy: "The lead implements every unfilled work package without dropping any acceptance criterion",
    integrationChecks: completionDefinition.acceptanceCriteria.map((criterion) => `${criterion.id}: ${criterion.passCondition}`),
  },
};

describe("task commitments", () => {
  it("creates a deterministic bytes32 commitment", () => {
    const spec = taskSpecSchema.parse({
      definitionReviewId: "f59d7736-338b-4a25-b844-4e1f4a79ba24",
      stakePositionId: 7, title: "Ship a real service", description: "Deliver a deployed service with monitoring and a rollback runbook.",
      category: "Development", maxExecutors: 2, declaredDurationHours: 48, criteria: collaborativeDefinition.acceptanceCriteria.map((item) => item.description), completionDefinition: collaborativeDefinition, requestedReward: 2500,
      hiddenTestManifestId: "07a92c98-e8c9-40f4-8f79-91a57f10186b", hiddenTestPlaintextSha256: "a".repeat(64),
    });
    expect(taskSpecHash(spec)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(taskSpecHash(spec)).toBe(taskSpecHash({ ...spec }));
  });

  it("rejects an untestable empty specification", () => {
    expect(() => taskSpecSchema.parse({})).toThrow();
  });

  it("rejects criteria that are changed outside the frozen completion definition", () => {
    expect(() => taskSpecSchema.parse({
      definitionReviewId: "f59d7736-338b-4a25-b844-4e1f4a79ba24",
      stakePositionId: 7, title: "Ship a real service", description: "Deliver a deployed service with monitoring and a rollback runbook.",
      category: "Development", maxExecutors: 2, declaredDurationHours: 48, criteria: ["Looks good", "Service builds without errors"], completionDefinition, requestedReward: 2500,
      hiddenTestManifestId: "07a92c98-e8c9-40f4-8f79-91a57f10186b", hiddenTestPlaintextSha256: "a".repeat(64),
    })).toThrow("CRITERIA_DEFINITION_MISMATCH");
  });

  it("rejects collaboration without an exact work package for every executor", () => {
    expect(() => taskSpecSchema.parse({
      definitionReviewId: "f59d7736-338b-4a25-b844-4e1f4a79ba24", stakePositionId: 7,
      title: "Ship a real service", description: "Deliver a deployed service with monitoring and a rollback runbook.",
      category: "Development", maxExecutors: 2, declaredDurationHours: 48,
      criteria: completionDefinition.acceptanceCriteria.map((item) => item.description), completionDefinition, requestedReward: 2500,
      hiddenTestManifestId: "07a92c98-e8c9-40f4-8f79-91a57f10186b", hiddenTestPlaintextSha256: "a".repeat(64),
    })).toThrow("COLLABORATION_PLAN_MISSING");
  });
});
