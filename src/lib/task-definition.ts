import { keccak256, stringToHex } from "viem";
import { z } from "zod";

export const taskDefinitionVersion = "AGENTGRID_TASK_DEFINITION_V1" as const;

const boundedLine = z.string().trim().min(3).max(500);
const reportHashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);

export const completionCriterionSchema = z.object({
  id: z.string().regex(/^criterion-[1-9][0-9]{0,1}$/),
  description: boundedLine,
  verificationMethod: boundedLine,
  evidenceRequired: boundedLine,
  passCondition: boundedLine,
  required: z.boolean().default(true),
}).strict();

export const taskDefinitionSchema = z.object({
  version: z.literal(taskDefinitionVersion),
  targetUsers: boundedLine,
  deliverables: z.array(boundedLine).min(1).max(20),
  constraints: z.array(boundedLine).min(1).max(20),
  outOfScope: z.array(boundedLine).min(1).max(20),
  assumptions: z.array(boundedLine).max(20).default([]),
  acceptanceCriteria: z.array(completionCriterionSchema).min(2).max(12),
  aiReviews: z.array(z.object({
    role: z.enum(["REQUIREMENTS_WRITER", "VALIDATION_CRITIC", "DOMAIN_REVIEWER"]),
    provider: z.string().trim().min(2).max(120),
    model: z.string().trim().min(1).max(120),
    reportHash: reportHashSchema,
  }).strict()).max(3).default([]),
}).strict().superRefine((definition, context) => {
  const ids = new Set<string>();
  const descriptions = new Set<string>();
  definition.acceptanceCriteria.forEach((criterion, index) => {
    if (criterion.id !== `criterion-${index + 1}`) context.addIssue({ code: "custom", path: ["acceptanceCriteria", index, "id"], message: "CRITERION_ORDER_INVALID" });
    if (ids.has(criterion.id)) context.addIssue({ code: "custom", path: ["acceptanceCriteria", index, "id"], message: "CRITERION_ID_DUPLICATE" });
    const normalized = criterion.description.toLowerCase();
    if (descriptions.has(normalized)) context.addIssue({ code: "custom", path: ["acceptanceCriteria", index, "description"], message: "CRITERION_DESCRIPTION_DUPLICATE" });
    ids.add(criterion.id);
    descriptions.add(normalized);
  });
  if (!definition.acceptanceCriteria.some((criterion) => criterion.required)) context.addIssue({ code: "custom", path: ["acceptanceCriteria"], message: "REQUIRED_CRITERION_MISSING" });
});

export const taskClarificationDraftSchema = z.object({
  publisher: z.string().trim().min(3).max(120),
  title: z.string().trim().min(8).max(160),
  businessOutcome: z.string().trim().min(30).max(10_000),
  category: z.string().trim().min(2).max(64),
  targetUsers: z.string().trim().max(500).default(""),
  deliverables: z.array(z.string().trim().max(500)).max(20).default([]),
  constraints: z.array(z.string().trim().max(500)).max(20).default([]),
  outOfScope: z.array(z.string().trim().max(500)).max(20).default([]),
  assumptions: z.array(z.string().trim().max(500)).max(20).default([]),
  criteria: z.array(z.object({
    description: z.string().trim().max(500),
    verificationMethod: z.string().trim().max(500),
    evidenceRequired: z.string().trim().max(500),
    passCondition: z.string().trim().max(500),
    required: z.boolean().default(true),
  }).strict()).max(12).default([]),
}).strict();

export const taskClarificationReviewSchema = z.object({
  role: z.enum(["REQUIREMENTS_WRITER", "VALIDATION_CRITIC", "DOMAIN_REVIEWER"]),
  summary: z.string().trim().min(10).max(1_500),
  clarifyingQuestions: z.array(z.object({
    id: z.string().trim().min(2).max(80),
    question: z.string().trim().min(8).max(500),
    reason: z.string().trim().min(8).max(500),
    blocking: z.boolean(),
  }).strict()).max(12),
  risks: z.array(boundedLine).max(12),
  suggestedTargetUsers: boundedLine,
  suggestedDeliverables: z.array(boundedLine).min(1).max(20),
  suggestedConstraints: z.array(boundedLine).min(1).max(20),
  suggestedOutOfScope: z.array(boundedLine).min(1).max(20),
  suggestedAssumptions: z.array(boundedLine).max(20),
  suggestedCriteria: z.array(completionCriterionSchema.omit({ id: true })).min(2).max(12),
}).strict();

export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
export type TaskClarificationDraft = z.infer<typeof taskClarificationDraftSchema>;
export type TaskClarificationReview = z.infer<typeof taskClarificationReviewSchema>;

const vagueTerms = /(?:good|great|best|high[- ]?quality|user[- ]?friendly|appropriate|reasonable|as needed|etc\.?|完善|优质|高质量|最好|合理|友好|适当|视情况|等等)/i;
const objectiveSignal = /(?:\d|%|>=|<=|=|通过|不得|必须|包含|不超过|不少于|at least|at most|must|pass|fail|contains?|without|zero|all\b|every\b)/i;

export type TaskDefinitionAssessment = {
  ready: boolean;
  score: number;
  blockers: string[];
  warnings: string[];
};

export function assessTaskDefinition(raw: unknown): TaskDefinitionAssessment {
  const parsed = taskDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    const blockers = [...new Set(parsed.error.issues.map((issue) => `INVALID_${issue.path.join("_").toUpperCase() || "DEFINITION"}`))];
    return { ready: false, score: Math.max(0, 100 - blockers.length * 15), blockers, warnings: [] };
  }
  const definition = parsed.data;
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (definition.targetUsers.length < 12) blockers.push("TARGET_USERS_TOO_VAGUE");
  if (definition.deliverables.some((item) => item.length < 8)) blockers.push("DELIVERABLE_NOT_SPECIFIC");
  if (definition.constraints.some((item) => item.length < 8)) warnings.push("CONSTRAINT_NOT_SPECIFIC");
  for (const criterion of definition.acceptanceCriteria) {
    if (vagueTerms.test(criterion.description) && !objectiveSignal.test(`${criterion.description} ${criterion.passCondition}`)) blockers.push(`CRITERION_${criterion.id}_SUBJECTIVE`);
    if (!objectiveSignal.test(criterion.passCondition)) warnings.push(`CRITERION_${criterion.id}_PASS_CONDITION_MAY_BE_AMBIGUOUS`);
    if (criterion.verificationMethod.toLowerCase() === criterion.description.toLowerCase()) warnings.push(`CRITERION_${criterion.id}_METHOD_REPEATS_REQUIREMENT`);
    if (criterion.evidenceRequired.toLowerCase() === criterion.passCondition.toLowerCase()) warnings.push(`CRITERION_${criterion.id}_EVIDENCE_NOT_DISTINCT`);
  }
  const score = Math.max(0, Math.min(100, 100 - new Set(blockers).size * 15 - new Set(warnings).size * 5));
  return { ready: blockers.length === 0 && score >= 80, score, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function taskDefinitionHash(definition: TaskDefinition) {
  return keccak256(stringToHex(JSON.stringify(canonical(taskDefinitionSchema.parse(definition)))));
}

export function reviewReportHash(review: TaskClarificationReview) {
  return keccak256(stringToHex(JSON.stringify(canonical(taskClarificationReviewSchema.parse(review)))));
}

export function definitionFromReview(review: TaskClarificationReview, aiReviews: TaskDefinition["aiReviews"] = []): TaskDefinition {
  return taskDefinitionSchema.parse({
    version: taskDefinitionVersion,
    targetUsers: review.suggestedTargetUsers,
    deliverables: review.suggestedDeliverables,
    constraints: review.suggestedConstraints,
    outOfScope: review.suggestedOutOfScope,
    assumptions: review.suggestedAssumptions,
    acceptanceCriteria: review.suggestedCriteria.map((criterion, index) => ({ id: `criterion-${index + 1}`, ...criterion })),
    aiReviews,
  });
}
