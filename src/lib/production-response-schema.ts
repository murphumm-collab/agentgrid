import { z } from "zod";
import { taskClarificationReviewSchema, taskDefinitionSchema } from "./task-definition";

const identifier = z.string().min(1).max(120);
const actor = z.string().min(3).max(120);
const dateTime = z.string().datetime({ offset: true });
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const sha256Hex = z.string().regex(/^[0-9a-fA-F]{64}$/);
const agentRole = z.enum(["EXECUTOR", "TESTER", "EVALUATOR", "BOTH"]);
const agentScope = z.enum(["tasks:claim", "tasks:submit", "tests:submit", "evaluations:submit", "heartbeat:write"]);

export const managedAgentSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(80),
  owner: actor,
  role: agentRole,
  capabilities: z.array(z.string().min(1).max(120)).max(64),
  endpoint: z.string().url().max(2_048),
  scopes: z.array(agentScope).max(5).optional(),
  revokedAt: dateTime.nullable().optional(),
  stakePositionId: z.string().regex(/^\d+$/).optional(),
  stake: z.number().nonnegative(),
  reputation: z.number().min(0).max(100),
  completedTasks: z.number().int().nonnegative(),
  online: z.boolean(),
}).strict();

export const taskSpecAssistantResponseSchema = z.object({
  aiAvailable: z.boolean(),
  reviews: z.array(z.object({
    role: z.enum(["REQUIREMENTS_WRITER", "VALIDATION_CRITIC", "DOMAIN_REVIEWER"]),
    provider: z.string().min(2).max(120),
    model: z.string().min(1).max(120),
    reportHash: bytes32,
    review: taskClarificationReviewSchema,
  }).strict()).min(2).max(3),
  recommendation: taskDefinitionSchema,
  assessment: z.object({
    ready: z.boolean(),
    score: z.number().min(0).max(100),
    blockers: z.array(z.string().min(1).max(200)).max(64),
    warnings: z.array(z.string().min(1).max(200)).max(64),
  }).strict(),
  definitionHash: bytes32,
  reviewedTaskHash: bytes32,
  definitionReview: z.object({ id: z.string().uuid(), expiresAt: dateTime }).strict().nullable(),
}).strict();

export const pendingTaskCommitmentResponseSchema = z.object({
  pending: z.object({
    commitmentId: z.string().uuid(),
    positionId: z.string().regex(/^\d+$/),
    specHash: bytes32,
    requestedReward: z.string().regex(/^\d+(?:\.\d+)?$/),
    maxExecutors: z.number().int().min(1).max(32),
    executionMode: z.enum(["COLLABORATION", "COMPETITION"]),
    requiredTesterCapabilities: z.number().int().nonnegative(),
    transactionHash: bytes32.optional(),
    broadcastReady: z.boolean(),
    retryAfter: dateTime.optional(),
  }).strict().superRefine((value, context) => {
    if (value.transactionHash && value.retryAfter) context.addIssue({ code: "custom", message: "PENDING_COMMITMENT_RECOVERY_STATE_INVALID" });
    if (!value.transactionHash && !value.retryAfter) context.addIssue({ code: "custom", message: "PENDING_COMMITMENT_RETRY_AFTER_REQUIRED" });
    if (value.transactionHash && value.broadcastReady) context.addIssue({ code: "custom", message: "BOUND_COMMITMENT_NOT_BROADCAST_READY" });
  }).nullable(),
}).strict();

export const createTaskCommitmentResponseSchema = z.object({
  id: z.string().uuid(),
  publisher: actor,
  specHash: bytes32,
  status: z.literal("DRAFT"),
  createdAt: dateTime,
  requestedReward: z.number().positive().max(1_000_000_000),
}).strict();

export const taskCommitmentTransactionResponseSchema = z.object({ commitmentId: z.string().uuid(), transactionHash: bytes32 }).strict();
export const clearedTaskCommitmentTransactionResponseSchema = z.object({ id: z.string().uuid(), cleared: z.literal(true) }).strict();
export const rotateAgentCredentialResponseSchema = z.object({
  agent: managedAgentSchema,
  apiKey: z.string().regex(/^amp_[A-Za-z0-9_-]{43}$/),
}).strict();
export const revokeAgentCredentialResponseSchema = z.object({ agent: managedAgentSchema, revokedAt: dateTime }).strict();
export const hiddenTestUploadResponseSchema = z.object({ id: z.string().uuid() }).strict();
export const hiddenTestContentResponseSchema = z.object({ uploaded: z.literal(true) }).strict();
export const hiddenTestFinalizeResponseSchema = z.object({
  id: z.string().uuid(),
  plaintextSha256: sha256Hex,
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  contentType: z.literal("application/gzip"),
}).strict();

export function isoTimestamp(value: string | Date) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("RESPONSE_TIMESTAMP_INVALID");
  return timestamp.toISOString();
}
