import { describe, expect, it } from "vitest";
import { automatedCriterionResults, validateCriterionEvidenceBindings, validateCriterionResults } from "./criterion-verification";
import { taskDefinitionSchema, taskDefinitionVersion } from "./task-definition";

const definition = taskDefinitionSchema.parse({
  version: taskDefinitionVersion, targetUsers: "Operations owner approving the service", deliverables: ["Runnable monitored service"], constraints: ["No network during verification"], outOfScope: ["Mainnet deployment changes"], assumptions: [], aiReviews: [],
  acceptanceCriteria: [
    { id: "criterion-1", description: "Every hidden test passes", verificationMethod: "Run sealed tests", evidenceRequired: "Signed result", passCondition: "Failed test count must equal 0", verificationType: "AUTOMATED_TEST", required: true },
    { id: "criterion-2", description: "Build command succeeds", verificationMethod: "Run production build", evidenceRequired: "Signed exit code", passCondition: "Exit code must equal 0", verificationType: "AUTOMATED_TEST", required: true },
  ],
});
const passingReport = { passed: true, testsPassed: true, hiddenTestsPassed: true, exitCode: 0, timedOut: false, lineCoverage: 0.95, branchCoverage: 0.95, functionCoverage: 0.95, criticalBranchCoverage: 1 };

describe("criterion-level verification", () => {
  it("binds every required criterion to ordered evidence", () => {
    const results = automatedCriterionResults(definition, passingReport, `sha256:${"a".repeat(64)}`);
    expect(validateCriterionResults(definition, results, true)).toHaveLength(2);
    expect(validateCriterionEvidenceBindings(results, `sha256:${"a".repeat(64)}`)).toHaveLength(2);
    expect(results.every((result) => result.passed && result.evidence.length > 0)).toBe(true);
  });

  it("rejects reordering and unsupported generic-CI claims", () => {
    const results = automatedCriterionResults(definition, passingReport, `sha256:${"a".repeat(64)}`);
    expect(() => validateCriterionResults(definition, [...results].reverse(), true)).toThrow("CRITERION_RESULT_ORDER_MISMATCH");
    const inspection = taskDefinitionSchema.parse({ ...definition, acceptanceCriteria: definition.acceptanceCriteria.map((criterion, index) => index ? criterion : { ...criterion, verificationType: "ARTIFACT_INSPECTION" }) });
    expect(() => automatedCriterionResults(inspection, passingReport, `sha256:${"a".repeat(64)}`)).toThrow("TESTER_CAPABILITY_MISMATCH");
  });

  it("requires typed evidence to bind passing results to the tested artifact", () => {
    const artifactHash = `sha256:${"a".repeat(64)}`;
    const results = automatedCriterionResults(definition, passingReport, artifactHash);
    expect(() => validateCriterionEvidenceBindings([{ ...results[0], evidence: [{ type: "METRIC", value: "tests=10" }] }, results[1]], artifactHash)).toThrow("CRITERION_ARTIFACT_BINDING_REQUIRED");
    expect(() => validateCriterionEvidenceBindings(results, `sha256:${"b".repeat(64)}`)).toThrow("CRITERION_ARTIFACT_BINDING_REQUIRED");
  });
});
