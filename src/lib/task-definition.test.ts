import { describe, expect, it } from "vitest";
import { assessTaskDefinition, collaborationPlanBlockers, definitionFromReview, reviewReportHash, taskDefinitionHash, taskDefinitionReviewBindingHash, taskDefinitionSchema } from "./task-definition";

const review = {
  role: "REQUIREMENTS_WRITER" as const,
  summary: "The task is narrowed to a deterministic monitored service delivery.",
  clarifyingQuestions: [],
  risks: ["Production credentials are supplied only through the deployment environment."],
  suggestedTargetUsers: "Operations analysts responsible for settlement monitoring",
  suggestedDeliverables: ["Runnable Node.js service archive", "Operator runbook with rollback steps"],
  suggestedConstraints: ["No third-party runtime dependency and no outbound network access in tests"],
  suggestedOutOfScope: ["Production credential provisioning and mainnet deployment"],
  suggestedAssumptions: ["Input events follow the committed JSON schema"],
  suggestedCriteria: [
    { description: "All public and hidden tests pass", verificationMethod: "Random tester executes the sealed test bundle in the no-network sandbox", evidenceRequired: "Signed sandbox report and immutable artifact hash", passCondition: "Exit code equals 0 and every hidden test passes", required: true },
    { description: "Critical branch coverage is at least 95%", verificationMethod: "Verifier-owned Node coverage command measures the committed artifact", evidenceRequired: "Coverage table in the signed tester report", passCondition: "Critical branch coverage is greater than or equal to 95%", required: true },
  ],
};

describe("task completion definition", () => {
  it("creates a deterministic committed definition and readiness score", () => {
    const reportHash = reviewReportHash(review);
    const definition = definitionFromReview(review, [{ role: "REQUIREMENTS_WRITER", provider: "test", model: "model-a", reportHash }]);
    expect(taskDefinitionHash(definition)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(assessTaskDefinition(definition)).toEqual({ ready: true, score: 100, blockers: [], warnings: [] });
  });

  it("binds a server review to the exact business outcome and completion definition", () => {
    const definition = definitionFromReview(review);
    const reviewed = { title: "Build settlement monitor", businessOutcome: "Alert operations before failed settlement breaches the service-level objective.", category: "Automation", executionMode: "COLLABORATION" as const, maxExecutors: 1, completionDefinition: definition };
    expect(taskDefinitionReviewBindingHash(reviewed)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(taskDefinitionReviewBindingHash(reviewed)).toBe(taskDefinitionReviewBindingHash({ ...reviewed }));
    expect(taskDefinitionReviewBindingHash({ ...reviewed, businessOutcome: `${reviewed.businessOutcome} Changed after review.` })).not.toBe(taskDefinitionReviewBindingHash(reviewed));
    expect(taskDefinitionReviewBindingHash({ ...reviewed, maxExecutors: 2 })).not.toBe(taskDefinitionReviewBindingHash(reviewed));
    expect(taskDefinitionReviewBindingHash({ ...reviewed, executionMode: "COMPETITION" })).not.toBe(taskDefinitionReviewBindingHash(reviewed));
  });

  it("rejects reordered, duplicate and entirely optional criteria", () => {
    const definition = definitionFromReview(review);
    expect(() => taskDefinitionSchema.parse({ ...definition, acceptanceCriteria: definition.acceptanceCriteria.map((item) => ({ ...item, required: false })) })).toThrow();
    expect(() => taskDefinitionSchema.parse({ ...definition, acceptanceCriteria: definition.acceptanceCriteria.map((item, index) => ({ ...item, id: index === 0 ? "criterion-2" : item.id })) })).toThrow();
    expect(() => taskDefinitionSchema.parse({ ...definition, acceptanceCriteria: [definition.acceptanceCriteria[0], { ...definition.acceptanceCriteria[0], id: "criterion-2" }] })).toThrow();
  });

  it("flags subjective completion language without an objective pass condition", () => {
    const definition = definitionFromReview({ ...review, suggestedCriteria: [
      { description: "The interface looks high quality", verificationMethod: "A tester reviews the interface", evidenceRequired: "A screenshot", passCondition: "The result feels appropriate", required: true },
      review.suggestedCriteria[1],
    ] });
    const result = assessTaskDefinition(definition);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("CRITERION_criterion-1_SUBJECTIVE");
  });

  it("covers every required criterion and executor with a closed collaboration plan", () => {
    const definition = definitionFromReview(review, [], { executionMode: "COLLABORATION", maxExecutors: 4 });
    expect(definition.collaborationPlan?.workPackages).toHaveLength(4);
    expect(new Set(definition.collaborationPlan?.workPackages.flatMap((item) => item.criterionIds))).toEqual(new Set(["criterion-1", "criterion-2"]));
    expect(collaborationPlanBlockers(definition, "COLLABORATION", 4)).toEqual([]);
    expect(collaborationPlanBlockers(definition, "COLLABORATION", 3)).toEqual(["COLLABORATION_WORK_PACKAGE_COUNT_MISMATCH"]);
    expect(collaborationPlanBlockers(definition, "COMPETITION", 4)).toEqual(["COLLABORATION_PLAN_FORBIDDEN_IN_COMPETITION"]);
    expect(() => taskDefinitionSchema.parse({ ...definition, collaborationPlan: { ...definition.collaborationPlan!, workPackages: definition.collaborationPlan!.workPackages.map((item, index) => index === 1 ? { ...item, dependsOn: [2] } : item) } })).toThrow("WORK_PACKAGE_DEPENDENCY_MUST_PRECEDE_SLOT");
  });
});
