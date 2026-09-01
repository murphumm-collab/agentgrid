import { z } from "zod";
import { jobIdPathParameterSchema, onchainTaskIdPathParameterSchema } from "./path-parameters";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const artifactHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const uint256DecimalSchema = z.string().min(1).max(78).regex(/^(0|[1-9][0-9]*)$/);
const positiveUnixSecondsSchema = z.string().min(1).max(78).regex(/^[1-9][0-9]*$/);

const provenanceShape = {
  chainId: z.literal(97).optional(),
  transactionHash: bytes32Schema.optional(),
  logIndex: z.number().int().nonnegative().max(1_000_000_000).optional(),
  blockNumber: uint256DecimalSchema.optional(),
  blockTimestamp: z.string().datetime({ offset: true }).optional(),
};

function requireCompleteProvenance(value: Record<string, unknown>, context: z.RefinementCtx) {
  const required = ["chainId", "transactionHash", "logIndex", "blockNumber"] as const;
  const present = required.filter((field) => value[field] !== undefined).length;
  if (present !== 0 && present !== required.length) {
    context.addIssue({ code: "custom", message: "AGENT_JOB_PROVENANCE_INCOMPLETE" });
  }
  if (value.blockTimestamp !== undefined && present !== required.length) {
    context.addIssue({ code: "custom", message: "AGENT_JOB_TIMESTAMP_WITHOUT_PROVENANCE" });
  }
}

function chainPayload<T extends z.ZodRawShape>(shape: T) {
  return z.object({ taskId: onchainTaskIdPathParameterSchema, ...provenanceShape, ...shape }).strict()
    .superRefine(requireCompleteProvenance);
}

export const chainAgentJobPayloadSchema = chainPayload({});
export const executeTaskJobPayloadSchema = chainPayload({
  slot: z.number().int().min(1).max(32).optional(),
  executorSlots: z.number().int().min(1).max(32).optional(),
}).superRefine((value, context) => {
  if ((value.slot === undefined) !== (value.executorSlots === undefined)) {
    context.addIssue({ code: "custom", message: "AGENT_JOB_EXECUTOR_SLOT_PAIR_REQUIRED" });
  }
  if (value.slot !== undefined && value.executorSlots !== undefined && value.slot > value.executorSlots) {
    context.addIssue({ code: "custom", message: "AGENT_JOB_EXECUTOR_SLOT_INVALID" });
  }
});
export const executorTargetJobPayloadSchema = chainPayload({ executor: addressSchema });
export const repairMaintenanceJobPayloadSchema = chainPayload({
  executor: addressSchema,
  checkpoint: z.number().int().min(1).max(3),
  evidenceHash: bytes32Schema,
});
export const evaluatorTargetJobPayloadSchema = chainPayload({ tester: addressSchema });
export const testerTargetJobPayloadSchema = chainPayload({ tester: addressSchema, shard: z.number().int().min(0).max(2) });
export const revealTestShardJobPayloadSchema = chainPayload({
  tester: addressSchema,
  shard: z.number().int().min(0).max(2),
  workRound: z.number().int().positive(),
  checkpoint: z.number().int().min(0).max(3),
  panelEpoch: z.number().int().positive(),
  reportHash: bytes32Schema,
  evidenceHash: bytes32Schema,
  criterionPassMask: z.number().int().min(0).max(65_535),
  winner: addressSchema,
  selectedArtifactHash: bytes32Schema,
  executorWeightsBps: z.array(z.number().int().min(0).max(10_000)).max(32),
  salt: bytes32Schema,
  passed: z.boolean(),
});
export const evaluationPanelJobPayloadSchema = chainPayload({
  selectionBlock: uint256DecimalSchema,
  deadline: positiveUnixSecondsSchema,
});
export const maintenancePanelJobPayloadSchema = z.object({
  taskId: onchainTaskIdPathParameterSchema,
  checkpoint: z.number().int().min(1).max(3),
  dueAt: positiveUnixSecondsSchema,
}).strict();
export const verificationPanelLifecycleJobPayloadSchema = z.object({
  taskId: onchainTaskIdPathParameterSchema,
  panelEpoch: z.number().int().positive(),
  dueAt: positiveUnixSecondsSchema,
}).strict();
export const verificationArbitrationExpiryJobPayloadSchema = z.object({
  taskId: onchainTaskIdPathParameterSchema,
  caseId: bytes32Schema,
  dueAt: positiveUnixSecondsSchema,
}).strict();

const createdAtSchema = z.string().datetime({ offset: true });
const job = <K extends string, R extends "EXECUTOR" | "TESTER" | "EVALUATOR" | "COORDINATOR", P extends z.ZodTypeAny>(kind: K, role: R, payload: P) => z.object({
  id: jobIdPathParameterSchema,
  role: z.literal(role),
  kind: z.literal(kind),
  payload,
  createdAt: createdAtSchema,
}).strict();

export const agentJobSchemas = {
  EXECUTE_TASK: job("EXECUTE_TASK", "EXECUTOR", executeTaskJobPayloadSchema),
  REVISE_TASK: job("REVISE_TASK", "EXECUTOR", executorTargetJobPayloadSchema),
  REPAIR_MAINTENANCE: job("REPAIR_MAINTENANCE", "EXECUTOR", repairMaintenanceJobPayloadSchema),
  ASSEMBLE_TASK: job("ASSEMBLE_TASK", "EXECUTOR", executorTargetJobPayloadSchema),
  TEST_TASK: job("TEST_TASK", "TESTER", testerTargetJobPayloadSchema),
  REVEAL_TEST_SHARD: job("REVEAL_TEST_SHARD", "TESTER", revealTestShardJobPayloadSchema),
  EVALUATE_TASK: job("EVALUATE_TASK", "EVALUATOR", evaluatorTargetJobPayloadSchema),
  FINALIZE_EVALUATION_PANEL: job("FINALIZE_EVALUATION_PANEL", "COORDINATOR", evaluationPanelJobPayloadSchema),
  FINALIZE_TASK_EVALUATION: job("FINALIZE_TASK_EVALUATION", "COORDINATOR", chainAgentJobPayloadSchema),
  ASSIGN_TESTER: job("ASSIGN_TESTER", "COORDINATOR", chainAgentJobPayloadSchema),
  FINALIZE_TESTER: job("FINALIZE_TESTER", "COORDINATOR", chainAgentJobPayloadSchema),
  START_MAINTENANCE_PANEL: job("START_MAINTENANCE_PANEL", "COORDINATOR", maintenancePanelJobPayloadSchema),
  FINALIZE_VERIFICATION_PANEL: job("FINALIZE_VERIFICATION_PANEL", "COORDINATOR", verificationPanelLifecycleJobPayloadSchema),
  EXPIRE_VERIFICATION_PANEL: job("EXPIRE_VERIFICATION_PANEL", "COORDINATOR", verificationPanelLifecycleJobPayloadSchema),
  EXPIRE_VERIFICATION_ARBITRATION: job("EXPIRE_VERIFICATION_ARBITRATION", "COORDINATOR", verificationArbitrationExpiryJobPayloadSchema),
} as const;

export const agentJobKinds = Object.keys(agentJobSchemas) as Array<keyof typeof agentJobSchemas>;
export const agentJobSchema = z.discriminatedUnion("kind", Object.values(agentJobSchemas) as [
  (typeof agentJobSchemas)[keyof typeof agentJobSchemas],
  (typeof agentJobSchemas)[keyof typeof agentJobSchemas],
  ...(typeof agentJobSchemas)[keyof typeof agentJobSchemas][],
]);
export const agentJobLeaseSchema = z.object({
  job: agentJobSchema,
  leaseSeconds: z.number().int().positive().max(86_400),
}).strict().nullable();

const executorFinalResultSchema = z.object({
  artifactHash: artifactHashSchema,
  transactionHash: bytes32Schema,
}).strict();
const executorContributionResultSchema = z.object({
  artifactHash: artifactHashSchema,
  contributionTransactionHash: bytes32Schema,
  slot: z.number().int().min(1).max(32),
}).strict();
export const executorJobCompletionResultSchema = z.union([
  executorFinalResultSchema,
  executorContributionResultSchema,
]);
export const assemblyJobCompletionResultSchema = z.object({
  artifactHash: artifactHashSchema,
  transactionHash: bytes32Schema,
  contributions: z.number().int().min(1).max(32),
}).strict();
export const testerJobCompletionResultSchema = z.object({
  reportHash: bytes32Schema,
  evidenceHash: bytes32Schema,
  transactionHash: bytes32Schema,
  passed: z.boolean(),
}).strict();
const testerCommitCompletionResultSchema = z.union([
  testerJobCompletionResultSchema,
  z.object({ reportHash: bytes32Schema, evidenceHash: bytes32Schema, alreadyCommitted: z.literal(true), passed: z.boolean() }).strict(),
]);
const testerRevealCompletionResultSchema = z.union([
  testerJobCompletionResultSchema,
  z.object({ reportHash: bytes32Schema, evidenceHash: bytes32Schema, alreadyRevealed: z.literal(true), passed: z.boolean() }).strict(),
]);
export const evaluatorJobCompletionResultSchema = z.union([
  z.object({ reportHash: bytes32Schema, transactionHash: bytes32Schema, approve: z.boolean() }).strict(),
  z.object({ reportHash: bytes32Schema, alreadySubmitted: z.literal(true), approve: z.boolean() }).strict(),
]);

const coordinatorTransactionResult = <P extends string>(phases: readonly [P, ...P[]]) => z.object({
  phase: z.enum(phases),
  transactionHash: bytes32Schema,
}).strict();
const coordinatorAlreadyFinalizedResult = <P extends string>(phase: P) => z.object({
  phase: z.literal(phase),
  alreadyFinalized: z.literal(true),
}).strict();

export const agentJobCompletionSchemas = {
  EXECUTE_TASK: executorJobCompletionResultSchema,
  REVISE_TASK: executorJobCompletionResultSchema,
  REPAIR_MAINTENANCE: executorJobCompletionResultSchema,
  ASSEMBLE_TASK: assemblyJobCompletionResultSchema,
  TEST_TASK: testerCommitCompletionResultSchema,
  REVEAL_TEST_SHARD: testerRevealCompletionResultSchema,
  EVALUATE_TASK: evaluatorJobCompletionResultSchema,
  FINALIZE_EVALUATION_PANEL: z.union([
    coordinatorTransactionResult(["finalizeEvaluationPanel"]),
    coordinatorAlreadyFinalizedResult("finalizeEvaluationPanel"),
  ]),
  FINALIZE_TASK_EVALUATION: z.union([
    coordinatorTransactionResult(["finalizeTaskEvaluation"]),
    coordinatorAlreadyFinalizedResult("finalizeTaskEvaluation"),
  ]),
  ASSIGN_TESTER: z.union([
    coordinatorTransactionResult(["requestTester"]),
    coordinatorAlreadyFinalizedResult("requestTester"),
  ]),
  FINALIZE_TESTER: z.union([
    coordinatorTransactionResult(["finalizeTester", "requestTester"]),
    coordinatorAlreadyFinalizedResult("finalizeTester"),
  ]),
  START_MAINTENANCE_PANEL: z.union([
    coordinatorTransactionResult(["requestMaintenancePanel"]),
    coordinatorAlreadyFinalizedResult("requestMaintenancePanel"),
  ]),
  FINALIZE_VERIFICATION_PANEL: z.union([
    coordinatorTransactionResult(["finalizeVerificationPanel"]),
    coordinatorAlreadyFinalizedResult("finalizeVerificationPanel"),
  ]),
  EXPIRE_VERIFICATION_PANEL: z.union([
    coordinatorTransactionResult(["expireVerificationPanel"]),
    coordinatorAlreadyFinalizedResult("expireVerificationPanel"),
  ]),
  EXPIRE_VERIFICATION_ARBITRATION: z.union([
    coordinatorTransactionResult(["expireVerificationArbitration"]),
    coordinatorAlreadyFinalizedResult("expireVerificationArbitration"),
  ]),
} as const satisfies Record<keyof typeof agentJobSchemas, z.ZodTypeAny>;

export const agentJobCompletionResultSchema = z.union(Object.values(agentJobCompletionSchemas) as unknown as [
  z.ZodTypeAny,
  z.ZodTypeAny,
  ...z.ZodTypeAny[],
]);

export function parseAgentJobCompletionResult<K extends keyof typeof agentJobCompletionSchemas>(kind: K, result: unknown) {
  return agentJobCompletionSchemas[kind].parse(result) as z.infer<(typeof agentJobCompletionSchemas)[K]>;
}

export type AgentJob = z.infer<typeof agentJobSchema>;
export type AgentJobRole = AgentJob["role"];
export type AgentJobKind = AgentJob["kind"];
export type AgentJobCompletionResult<K extends AgentJobKind = AgentJobKind> = z.infer<(typeof agentJobCompletionSchemas)[K]>;
