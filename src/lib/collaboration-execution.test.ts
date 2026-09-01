import { describe, expect, it } from "vitest";
import { collaborationAssemblyPrompt, collaborationExecutionPrompt, collaborationWorkPackage } from "./collaboration-execution";
import { definitionFromReview } from "./task-definition";

const review = {
  role: "REQUIREMENTS_WRITER" as const, summary: "A complete independently verifiable delivery definition.", clarifyingQuestions: [], risks: [],
  suggestedTargetUsers: "Operations owners who approve the delivered service",
  suggestedDeliverables: ["Runnable service archive", "Reproducible operations guide"],
  suggestedConstraints: ["No network access during independent verification"],
  suggestedOutOfScope: ["Production credentials and public deployment"], suggestedAssumptions: [],
  suggestedCriteria: [
    { description: "All tests pass", verificationMethod: "Tester runs the sealed suite", evidenceRequired: "Signed test report", passCondition: "Failure count must equal 0", verificationType: "AUTOMATED_TEST" as const, required: true },
    { description: "Build succeeds", verificationMethod: "Tester runs the production build", evidenceRequired: "Signed build log", passCondition: "Exit code must equal 0", verificationType: "AUTOMATED_TEST" as const, required: true },
  ],
};

describe("collaboration execution contract", () => {
  const definition = definitionFromReview(review, [], { executionMode: "COLLABORATION", maxExecutors: 2 });

  it("resolves one exact frozen work package per slot", () => {
    expect(collaborationWorkPackage(definition, 2, 2).workPackage.slot).toBe(2);
    expect(collaborationExecutionPrompt(definition, 2, 1)).toContain("criterion-1");
    expect(() => collaborationWorkPackage(definition, 3, 1)).toThrow("COLLABORATION_WORK_PACKAGE_COUNT_MISMATCH");
  });

  it("freezes lead ownership for unfilled slots and labels every received slot", () => {
    expect(collaborationAssemblyPrompt(definition, [{ slot: 1, contributor: "0x1", manifest: {} }])).toContain("Lead-owned unfilled work packages: 2:");
    expect(collaborationAssemblyPrompt(definition, [
      { slot: 2, contributor: "0x2", manifest: { summary: "two" } },
      { slot: 1, contributor: "0x1", manifest: { summary: "one" } },
    ])).toContain("Frozen assembly strategy");
    expect(() => collaborationAssemblyPrompt(definition, [{ slot: 1, contributor: "0x1", manifest: {} }, { slot: 1, contributor: "0x2", manifest: {} }])).toThrow("COLLABORATION_CONTRIBUTION_SLOT_DUPLICATE");
  });
});
