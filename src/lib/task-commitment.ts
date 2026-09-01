import { keccak256, stringToHex } from "viem";
import { z } from "zod";
import { assessTaskDefinition, collaborationPlanBlockers, taskDefinitionSchema, verificationPlanBlockers } from "./task-definition";
import { walletAddressSchema } from "./auth-schema";

export const taskSpecFieldsSchema = z.object({
  definitionReviewId: z.string().uuid(),
  stakePositionId: z.coerce.number().int().positive(),
  title: z.string().trim().min(8).max(160),
  description: z.string().trim().min(30).max(10_000),
  category: z.string().trim().min(2).max(64),
  executionMode: z.enum(["COLLABORATION", "COMPETITION"]).default("COLLABORATION"),
  maxExecutors: z.coerce.number().int().min(1).max(32),
  declaredDurationHours: z.coerce.number().int().min(1).max(24 * 90),
  criteria: z.array(z.string().trim().min(3).max(500)).min(1).max(30),
  completionDefinition: taskDefinitionSchema,
  requestedReward: z.coerce.number().positive().max(1_000_000_000),
  hiddenTestManifestId: z.string().uuid(),
  hiddenTestPlaintextSha256: z.string().regex(/^[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase()),
}).strict();

function validateTaskSpec(spec: z.output<typeof taskSpecFieldsSchema>, context: z.RefinementCtx) {
  const committed = spec.completionDefinition.acceptanceCriteria;
  if (spec.criteria.length !== committed.length || spec.criteria.some((criterion, index) => criterion !== committed[index]?.description)) {
    context.addIssue({ code: "custom", path: ["criteria"], message: "CRITERIA_DEFINITION_MISMATCH" });
  }
  const assessment = assessTaskDefinition(spec.completionDefinition);
  if (!assessment.ready) context.addIssue({ code: "custom", path: ["completionDefinition"], message: `COMPLETION_DEFINITION_NOT_READY:${[...assessment.blockers, ...assessment.warnings].join(",")}` });
  for (const blocker of collaborationPlanBlockers(spec.completionDefinition, spec.executionMode, spec.maxExecutors)) {
    context.addIssue({ code: "custom", path: ["completionDefinition", "collaborationPlan"], message: blocker });
  }
  for (const blocker of verificationPlanBlockers(spec.completionDefinition)) context.addIssue({ code: "custom", path: ["completionDefinition", "verificationPlan"], message: blocker });
}

export const taskSpecSchema = taskSpecFieldsSchema.superRefine(validateTaskSpec);
export const taskCommitmentRequestSchema = taskSpecFieldsSchema.extend({
  publisher: walletAddressSchema,
}).superRefine(validateTaskSpec);
export const taskCommitmentTransactionSchema = z.object({
  publisher: walletAddressSchema,
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
}).strict();

export type TaskSpec = z.infer<typeof taskSpecSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function taskSpecHash(spec: TaskSpec) {
  return keccak256(stringToHex(JSON.stringify(canonical(spec))));
}
