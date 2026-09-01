import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { signedEvidenceSubmissionSchema, testEvidenceReportSchema } from "./test-evidence-schema";
import { signedTaskEvaluationSubmissionSchema, taskEvaluationReportSchema } from "./task-evaluation";
import { taskCommitmentTransactionSchema, taskSpecFieldsSchema } from "./task-commitment";
import { taskClarificationDraftSchema } from "./task-definition";

type JsonSchema = {
  $ref?: string;
  additionalProperties?: boolean | JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

type OpenApi = {
  info: { version: string };
  paths: Record<string, Record<string, {
    requestBody?: { content?: { "application/json"?: { schema: JsonSchema } } };
    responses: Record<string, unknown>;
  }>>;
  components: { schemas: Record<string, JsonSchema> };
};

const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8")) as OpenApi;

function routeSources(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, directory);
    if (entry.isDirectory()) return routeSources(target);
    return entry.name === "route.ts" ? [readFileSync(target, "utf8")] : [];
  });
}

function resolve(schema: JsonSchema) {
  if (!schema.$ref) return schema;
  const name = schema.$ref.match(/^#\/components\/schemas\/([^/]+)$/)?.[1];
  if (!name || !openapi.components.schemas[name]) throw new Error(`OPENAPI_SCHEMA_REF_INVALID_${schema.$ref}`);
  return openapi.components.schemas[name];
}

describe("OpenAPI JSON write contracts", () => {
  it("executes a runtime schema for every repository JSON route", () => {
    const source = routeSources(new URL("../app/api/", import.meta.url)).join("\n");
    expect(source).not.toMatch(/readJsonBody\s*</);
    expect(source.match(/readJsonBody\(/g)).toHaveLength(28);
    expect(source.match(/\.parse\(await readJsonBody\(/g)).toHaveLength(28);
  });

  it("closes every advertised JSON request envelope and documents body-policy failures", () => {
    const jsonWrites: string[] = [];
    for (const [path, pathItem] of Object.entries(openapi.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        const schema = operation.requestBody?.content?.["application/json"]?.schema;
        if (!schema) continue;
        jsonWrites.push(`${method.toUpperCase()} ${path}`);
        expect(resolve(schema).additionalProperties, `${method.toUpperCase()} ${path}`).toBe(false);
        for (const status of ["400", "413", "415"]) {
          expect(operation.responses[status], `${method.toUpperCase()} ${path} response ${status}`).toBeTruthy();
        }
      }
    }
    expect(jsonWrites).toHaveLength(19);
  });

  it("enumerates every runtime field needed to sign evaluation and test evidence", () => {
    expect(openapi.info.version).toBe("0.8.12");
    const evaluation = openapi.components.schemas.TaskEvaluationReport;
    expect(Object.keys(evaluation.properties ?? {}).sort()).toEqual([...taskEvaluationReportSchema.keyof().options].sort());
    expect([...(evaluation.required ?? [])].sort()).toEqual([...taskEvaluationReportSchema.keyof().options].sort());

    const evaluationSubmission = openapi.components.schemas.SignedTaskEvaluationSubmission;
    expect(Object.keys(evaluationSubmission.properties ?? {}).sort()).toEqual([...signedTaskEvaluationSubmissionSchema.keyof().options].sort());
    expect([...(evaluationSubmission.required ?? [])].sort()).toEqual([...signedTaskEvaluationSubmissionSchema.keyof().options].sort());

    const submission = openapi.components.schemas.SignedEvidenceSubmission;
    expect(Object.keys(submission.properties ?? {}).sort()).toEqual([...signedEvidenceSubmissionSchema.keyof().options].sort());
    expect([...(submission.required ?? [])].sort()).toEqual([...signedEvidenceSubmissionSchema.keyof().options].sort());

    const report = openapi.components.schemas.TestEvidenceReport;
    expect(Object.keys(report.properties ?? {}).sort()).toEqual([...testEvidenceReportSchema.keyof().options].sort());
    expect([...(report.required ?? [])].sort()).toEqual([
      "branchCoverage", "contributionWork", "criticalBranchCoverage", "durationMs", "executorWeightsBps",
      "exitCode", "functionCoverage", "hiddenTestsPassed", "lineCoverage", "passed", "sandbox", "stderr",
      "stdout", "testsPassed", "timedOut",
    ].sort());
    expect(resolve(report.properties?.sandbox ?? {}).additionalProperties).toBe(false);

    const commitment = openapi.components.schemas.TaskCommitmentRequest;
    expect(Object.keys(commitment.properties ?? {}).sort()).toEqual([
      ...taskSpecFieldsSchema.keyof().options, "publisher",
    ].sort());
    expect([...(commitment.required ?? [])].sort()).toEqual([
      "publisher", "definitionReviewId", "stakePositionId", "title", "description", "category",
      "maxExecutors", "declaredDurationHours", "criteria", "completionDefinition", "requestedReward",
      "hiddenTestManifestId", "hiddenTestPlaintextSha256",
    ].sort());
    const transaction = openapi.components.schemas.TaskCommitmentTransactionBody;
    expect(Object.keys(transaction.properties ?? {}).sort()).toEqual([...taskCommitmentTransactionSchema.keyof().options].sort());
    expect([...(transaction.required ?? [])].sort()).toEqual([...taskCommitmentTransactionSchema.keyof().options].sort());

    const clarification = openapi.paths["/api/task-spec-assistant"].post.requestBody?.content?.["application/json"]?.schema;
    expect(Object.keys(resolve(clarification!).properties ?? {}).sort()).toEqual([...taskClarificationDraftSchema.keyof().options].sort());
    expect(resolve(clarification!).required?.sort()).toEqual(["publisher", "title", "businessOutcome", "category"].sort());
  });
});
