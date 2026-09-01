import { z } from "zod";
import { businessWorkflowTypes } from "./business-adoption";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const databaseTimestamp = z.union([z.string().min(1).max(64), z.date()]).transform((value, context) => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "DATABASE_TIMESTAMP_INVALID" });
    return z.NEVER;
  }
  return new Date(timestamp).toISOString();
});
const notificationPayload = z.record(z.string().min(1).max(120), z.unknown()).superRefine((value, context) => {
  if (Object.keys(value).length > 64) context.addIssue({ code: z.ZodIssueCode.custom, message: "NOTIFICATION_PAYLOAD_FIELDS_EXCEEDED" });
  let encoded: string;
  try { encoded = JSON.stringify(value); }
  catch { context.addIssue({ code: z.ZodIssueCode.custom, message: "NOTIFICATION_PAYLOAD_INVALID" }); return; }
  if (Buffer.byteLength(encoded) > 64 * 1024) context.addIssue({ code: z.ZodIssueCode.custom, message: "NOTIFICATION_PAYLOAD_TOO_LARGE" });
});

const notificationSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().min(1).max(128).nullable(),
  kind: z.string().min(1).max(120),
  payload: notificationPayload,
  readAt: databaseTimestamp.nullable(),
  createdAt: databaseTimestamp,
}).strict();

export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema).max(100),
  unread: z.number().int().nonnegative().max(100),
}).strict();

export const notificationReadResponseSchema = z.object({
  id: z.string().uuid(),
  readAt: databaseTimestamp,
}).strict();

const releaseSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().regex(/^\d+$/),
  publisher: address,
  artifactHash: sha256,
  createdAt: databaseTimestamp,
}).strict();

const adoptionSchema = z.object({
  publisher: address,
  artifactHash: sha256,
  workflowType: z.enum(businessWorkflowTypes),
  workflowEvidenceHash: sha256,
  adoptedAt: databaseTimestamp,
  reportHash: bytes32,
  attestedAt: databaseTimestamp,
}).strict();

export const businessAdoptionStatusResponseSchema = z.union([
  z.object({ adoption: adoptionSchema }).strict(),
  z.object({ chainId: z.literal(97), release: releaseSchema }).strict(),
]);

export const businessAdoptionSubmissionResponseSchema = z.object({
  ok: z.literal(true),
  reportHash: bytes32,
}).strict();
