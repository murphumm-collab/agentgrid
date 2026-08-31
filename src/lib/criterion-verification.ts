import { z } from "zod";
import { taskDefinitionSchema, verificationTypes, type TaskDefinition } from "./task-definition";

export const criterionEvidenceSchema = z.object({
  type: z.enum(["ARTIFACT_HASH", "TEST_MANIFEST_HASH", "SIGNED_LOG_HASH", "METRIC", "EXTERNAL_EVIDENCE_HASH"]),
  value: z.string().trim().min(3).max(500).refine((value) => !/^https?:\/\//i.test(value), "EVIDENCE_URL_FORBIDDEN"),
}).strict().superRefine((evidence, context) => {
  if (evidence.type === "METRIC") return;
  const hashPattern = evidence.type === "ARTIFACT_HASH" || evidence.type === "TEST_MANIFEST_HASH"
    ? /^sha256:[0-9a-f]{64}$/i
    : /^(?:sha256:[0-9a-f]{64}|0x[0-9a-f]{64})$/i;
  if (!hashPattern.test(evidence.value)) context.addIssue({ code: "custom", path: ["value"], message: "EVIDENCE_HASH_REQUIRED" });
});

export const criterionVerificationResultSchema = z.object({
  criterionId: z.string().regex(/^criterion-[1-9][0-9]{0,1}$/),
  verificationType: z.enum(verificationTypes),
  passed: z.boolean(),
  observation: z.string().trim().min(3).max(1_500),
  evidence: z.array(criterionEvidenceSchema).max(12),
}).strict().superRefine((result, context) => {
  if (result.passed && result.evidence.length === 0) context.addIssue({ code: "custom", path: ["evidence"], message: "PASSED_CRITERION_REQUIRES_EVIDENCE" });
});

export const criterionVerificationResultsSchema = z.array(criterionVerificationResultSchema).max(12);
export type CriterionVerificationResult = z.infer<typeof criterionVerificationResultSchema>;

export function validateCriterionResults(definitionRaw: TaskDefinition, resultsRaw: unknown, overallPassed: boolean) {
  const definition = taskDefinitionSchema.parse(definitionRaw);
  const results = criterionVerificationResultsSchema.parse(resultsRaw);
  if (results.length !== definition.acceptanceCriteria.length) throw new Error("CRITERION_RESULT_COUNT_MISMATCH");
  for (let index = 0; index < definition.acceptanceCriteria.length; index += 1) {
    const criterion = definition.acceptanceCriteria[index];
    const result = results[index];
    if (result.criterionId !== criterion.id) throw new Error("CRITERION_RESULT_ORDER_MISMATCH");
    if (result.verificationType !== criterion.verificationType) throw new Error("CRITERION_VERIFICATION_TYPE_MISMATCH");
    if (overallPassed && criterion.required && !result.passed) throw new Error("REQUIRED_CRITERION_NOT_PASSED");
  }
  if (!overallPassed && results.every((result) => result.passed)) throw new Error("OVERALL_FAILURE_WITHOUT_FAILED_CRITERION");
  return results;
}

export function validateCriterionEvidenceBindings(resultsRaw: unknown, artifactHash: string) {
  const results = criterionVerificationResultsSchema.parse(resultsRaw);
  for (const result of results) {
    if (!result.passed) continue;
    const contains = (type: typeof result.evidence[number]["type"]) => result.evidence.some((item) => item.type === type);
    if (["AUTOMATED_TEST", "ARTIFACT_INSPECTION", "DATA_VALIDATION"].includes(result.verificationType)
      && !result.evidence.some((item) => item.type === "ARTIFACT_HASH" && item.value.toLowerCase() === artifactHash.toLowerCase())) {
      throw new Error("CRITERION_ARTIFACT_BINDING_REQUIRED");
    }
    if ((result.verificationType === "AUTOMATED_TEST" || result.verificationType === "DATA_VALIDATION") && !contains("METRIC")) {
      throw new Error("CRITERION_METRIC_REQUIRED");
    }
    if ((result.verificationType === "EXTERNAL_OBSERVATION" || result.verificationType === "HUMAN_REVIEW") && !contains("EXTERNAL_EVIDENCE_HASH")) {
      throw new Error("CRITERION_EXTERNAL_EVIDENCE_REQUIRED");
    }
  }
  return results;
}

export function automatedCriterionResults(definitionRaw: TaskDefinition, report: {
  passed: boolean; testsPassed: boolean; hiddenTestsPassed: boolean; exitCode: number; timedOut: boolean;
  lineCoverage: number; branchCoverage: number; functionCoverage: number; criticalBranchCoverage: number;
}, artifactHash: string): CriterionVerificationResult[] {
  const definition = taskDefinitionSchema.parse(definitionRaw);
  if (definition.acceptanceCriteria.some((criterion) => criterion.required && criterion.verificationType !== "AUTOMATED_TEST")) throw new Error("TESTER_CAPABILITY_MISMATCH");
  const passed = report.passed && report.testsPassed && report.hiddenTestsPassed && report.exitCode === 0 && !report.timedOut;
  return definition.acceptanceCriteria.map((criterion) => criterionVerificationResultSchema.parse({
    criterionId: criterion.id,
    verificationType: criterion.verificationType,
    passed: criterion.verificationType === "AUTOMATED_TEST" ? passed : false,
    observation: criterion.verificationType === "AUTOMATED_TEST"
      ? `Sandbox exit=${report.exitCode}; publicTests=${report.testsPassed}; hiddenTests=${report.hiddenTestsPassed}; timedOut=${report.timedOut}; line=${report.lineCoverage}; branch=${report.branchCoverage}; function=${report.functionCoverage}; critical=${report.criticalBranchCoverage}`
      : "The generic CI tester is not authorized to claim this non-automated criterion was verified.",
    evidence: criterion.verificationType === "AUTOMATED_TEST" ? [
      { type: "ARTIFACT_HASH", value: artifactHash },
      { type: "METRIC", value: `testsPassed=${report.testsPassed}` },
      { type: "METRIC", value: `hiddenTestsPassed=${report.hiddenTestsPassed}` },
      { type: "METRIC", value: `exitCode=${report.exitCode}` },
    ] : [],
  }));
}
