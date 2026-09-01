import { keccak256, stringToHex } from "viem";
import { z } from "zod";
import { assertVerificationCoverage, createVerificationPlan, verificationPlanSchema } from "./verification-panel";

export const taskDefinitionVersion = "AGENTGRID_TASK_DEFINITION_V1" as const;
export const verificationTypes = ["AUTOMATED_TEST", "ARTIFACT_INSPECTION", "DATA_VALIDATION", "EXTERNAL_OBSERVATION", "HUMAN_REVIEW"] as const;
export type VerificationType = typeof verificationTypes[number];

const boundedLine = z.string().trim().min(3).max(500);
const reportHashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);

export const completionCriterionSchema = z.object({
  id: z.string().regex(/^criterion-[1-9][0-9]{0,1}$/),
  description: boundedLine,
  verificationMethod: boundedLine,
  evidenceRequired: boundedLine,
  passCondition: boundedLine,
  verificationType: z.enum(verificationTypes).default("AUTOMATED_TEST"),
  required: z.boolean().default(true),
}).strict();

export const collaborationWorkPackageSchema = z.object({
  slot: z.number().int().min(1).max(32),
  title: z.string().trim().min(3).max(120),
  objective: boundedLine,
  deliverables: z.array(boundedLine).min(1).max(10),
  dependsOn: z.array(z.number().int().min(1).max(32)).max(31).default([]),
  criterionIds: z.array(z.string().regex(/^criterion-[1-9][0-9]{0,1}$/)).min(1).max(12),
}).strict();

export const collaborationPlanSchema = z.object({
  workPackages: z.array(collaborationWorkPackageSchema).min(2).max(32),
  sharedInterfaces: z.array(boundedLine).min(1).max(12),
  assemblyStrategy: boundedLine,
  underfilledStrategy: boundedLine,
  integrationChecks: z.array(boundedLine).min(1).max(12),
}).strict().superRefine((plan, context) => {
  const titles = new Set<string>();
  plan.workPackages.forEach((item, index) => {
    if (item.slot !== index + 1) context.addIssue({ code: "custom", path: ["workPackages", index, "slot"], message: "WORK_PACKAGE_SLOT_ORDER_INVALID" });
    const title = item.title.toLowerCase();
    if (titles.has(title)) context.addIssue({ code: "custom", path: ["workPackages", index, "title"], message: "WORK_PACKAGE_TITLE_DUPLICATE" });
    titles.add(title);
    const dependencies = new Set<number>();
    item.dependsOn.forEach((dependency, dependencyIndex) => {
      if (dependency >= item.slot) context.addIssue({ code: "custom", path: ["workPackages", index, "dependsOn", dependencyIndex], message: "WORK_PACKAGE_DEPENDENCY_MUST_PRECEDE_SLOT" });
      if (dependencies.has(dependency)) context.addIssue({ code: "custom", path: ["workPackages", index, "dependsOn", dependencyIndex], message: "WORK_PACKAGE_DEPENDENCY_DUPLICATE" });
      dependencies.add(dependency);
    });
  });
});

export const taskDefinitionSchema = z.object({
  version: z.literal(taskDefinitionVersion),
  targetUsers: boundedLine,
  deliverables: z.array(boundedLine).min(1).max(20),
  constraints: z.array(boundedLine).min(1).max(20),
  outOfScope: z.array(boundedLine).min(1).max(20),
  assumptions: z.array(boundedLine).max(20).default([]),
  acceptanceCriteria: z.array(completionCriterionSchema).min(2).max(12),
  // Optional only for parsing already-committed V1 tasks. Every newly reviewed
  // task receives a frozen plan and publication rejects its absence.
  verificationPlan: verificationPlanSchema.optional(),
  collaborationPlan: collaborationPlanSchema.optional(),
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
  if (definition.verificationPlan) try {
    assertVerificationCoverage(definition.verificationPlan, definition.acceptanceCriteria.filter((criterion) => criterion.required).map((criterion) => criterion.id));
  } catch (error) {
    context.addIssue({ code: "custom", path: ["verificationPlan"], message: error instanceof Error ? error.message : "VERIFICATION_PLAN_INVALID" });
  }
  if (definition.collaborationPlan) {
    const knownCriteria = new Set(definition.acceptanceCriteria.map((criterion) => criterion.id));
    const coveredCriteria = new Set<string>();
    definition.collaborationPlan.workPackages.forEach((item, packageIndex) => item.criterionIds.forEach((criterionId, criterionIndex) => {
      if (!knownCriteria.has(criterionId)) context.addIssue({ code: "custom", path: ["collaborationPlan", "workPackages", packageIndex, "criterionIds", criterionIndex], message: "WORK_PACKAGE_CRITERION_UNKNOWN" });
      coveredCriteria.add(criterionId);
    }));
    definition.acceptanceCriteria.forEach((criterion) => {
      if (criterion.required && !coveredCriteria.has(criterion.id)) context.addIssue({ code: "custom", path: ["collaborationPlan", "workPackages"], message: `REQUIRED_CRITERION_UNASSIGNED:${criterion.id}` });
    });
  }
});

export const taskClarificationDraftSchema = z.object({
  publisher: z.string().trim().min(3).max(120),
  title: z.string().trim().min(8).max(160),
  businessOutcome: z.string().trim().min(30).max(10_000),
  category: z.string().trim().min(2).max(64),
  executionMode: z.enum(["COLLABORATION", "COMPETITION"]).default("COLLABORATION"),
  maxExecutors: z.coerce.number().int().min(1).max(32).default(1),
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
    verificationType: z.enum(verificationTypes).default("AUTOMATED_TEST"),
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

export const taskDefinitionReviewBindingSchema = z.object({
  title: z.string().trim().min(8).max(160),
  businessOutcome: z.string().trim().min(30).max(10_000),
  category: z.string().trim().min(2).max(64),
  executionMode: z.enum(["COLLABORATION", "COMPETITION"]),
  maxExecutors: z.number().int().min(1).max(32),
  completionDefinition: taskDefinitionSchema,
}).strict();

export type TaskDefinition = z.infer<typeof taskDefinitionSchema>;
export type TaskClarificationDraft = z.infer<typeof taskClarificationDraftSchema>;
export type TaskClarificationReview = z.infer<typeof taskClarificationReviewSchema>;
export type CollaborationPlan = z.infer<typeof collaborationPlanSchema>;

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

export function collaborationPlanBlockers(definition: TaskDefinition, executionMode: "COLLABORATION" | "COMPETITION", maxExecutors: number) {
  const plan = definition.collaborationPlan;
  if (executionMode === "COMPETITION") return plan ? ["COLLABORATION_PLAN_FORBIDDEN_IN_COMPETITION"] : [];
  if (maxExecutors === 1) return plan ? ["COLLABORATION_PLAN_REQUIRES_MULTIPLE_EXECUTORS"] : [];
  if (!plan) return ["COLLABORATION_PLAN_MISSING"];
  if (plan.workPackages.length !== maxExecutors) return ["COLLABORATION_WORK_PACKAGE_COUNT_MISMATCH"];
  return [];
}

export function verificationPlanBlockers(definition: TaskDefinition) {
  if (!definition.verificationPlan) return ["VERIFICATION_PLAN_MISSING"];
  try {
    assertVerificationCoverage(definition.verificationPlan, definition.acceptanceCriteria.filter((criterion) => criterion.required).map((criterion) => criterion.id));
    return [];
  } catch (error) { return [error instanceof Error ? error.message : "VERIFICATION_PLAN_INVALID"]; }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function taskDefinitionHash(definition: TaskDefinition) {
  return keccak256(stringToHex(JSON.stringify(canonical(taskDefinitionSchema.parse(definition)))));
}

export function taskDefinitionReviewBindingHash(raw: unknown) {
  return keccak256(stringToHex(JSON.stringify(canonical(taskDefinitionReviewBindingSchema.parse(raw)))));
}

export function reviewReportHash(review: TaskClarificationReview) {
  return keccak256(stringToHex(JSON.stringify(canonical(taskClarificationReviewSchema.parse(review)))));
}

export function definitionFromReview(review: TaskClarificationReview, aiReviews: TaskDefinition["aiReviews"] = [], execution?: Pick<TaskClarificationDraft, "executionMode" | "maxExecutors">): TaskDefinition {
  const criteria = review.suggestedCriteria.map((criterion, index) => ({ id: `criterion-${index + 1}`, ...criterion }));
  const collaborationPlan = execution?.executionMode === "COLLABORATION" && execution.maxExecutors > 1 ? {
    workPackages: Array.from({ length: execution.maxExecutors }, (_, index) => {
      const assigned = criteria.filter((_, criterionIndex) => criterionIndex % execution.maxExecutors === index);
      const covered = assigned.length ? assigned : [criteria[index % criteria.length]];
      const primaryDeliverable = review.suggestedDeliverables[index % review.suggestedDeliverables.length];
      return {
        slot: index + 1,
        title: `Workstream ${index + 1}: ${covered[0].description.slice(0, 80)}`,
        objective: `Own a runnable, independently reviewable contribution for ${covered.map((criterion) => criterion.id).join(", ")} without silently changing another workstream's files or interfaces.`,
        deliverables: [primaryDeliverable, `Handoff manifest mapping changed files, exported interfaces, evidence, and unresolved risks to ${covered.map((criterion) => criterion.id).join(", ")}.`],
        dependsOn: [],
        criterionIds: covered.map((criterion) => criterion.id),
      };
    }),
    sharedInterfaces: [
      "Every archive must contain a machine-readable project manifest and use repository-relative paths without traversal.",
      "Every handoff must name changed files, exported interfaces, criterion IDs, evidence, and unresolved risks; undocumented interface changes fail integration.",
    ],
    assemblyStrategy: "The designated lead consumes every committed work package, resolves file and interface conflicts explicitly, preserves provenance, and produces one runnable artifact rather than selecting or copying a single contribution.",
    underfilledStrategy: "If recruitment closes below the requested executor count, the lead explicitly implements every unfilled work package during assembly and records those packages as lead-owned; no acceptance criterion or integration check may be dropped.",
    integrationChecks: criteria.map((criterion) => `${criterion.id}: ${criterion.passCondition}`),
  } satisfies CollaborationPlan : undefined;
  return taskDefinitionSchema.parse({
    version: taskDefinitionVersion,
    targetUsers: review.suggestedTargetUsers,
    deliverables: review.suggestedDeliverables,
    constraints: review.suggestedConstraints,
    outOfScope: review.suggestedOutOfScope,
    assumptions: review.suggestedAssumptions,
    acceptanceCriteria: criteria,
    verificationPlan: createVerificationPlan(criteria.filter((criterion) => criterion.required).map((criterion) => criterion.id)),
    ...(collaborationPlan ? { collaborationPlan } : {}),
    aiReviews,
  });
}
