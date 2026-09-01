import { z } from "zod";
import { walletAddressSchema } from "./auth-schema";

export const agentIdBodySchema = z.object({
  agentId: z.string().min(3).max(120),
}).strict();

export const artifactUploadRequestSchema = z.object({
  taskId: z.string().min(1).max(120),
  agentId: z.string().min(3).max(120),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
  contentType: z.literal("application/gzip"),
  plaintextSha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  encryptionAlgorithm: z.literal("AES-256-GCM"),
  contentIv: z.string().min(16).max(32),
  encryptionKey: z.string().min(40).max(64),
}).strict();

export const hiddenTestUploadRequestSchema = z.object({
  publisher: walletAddressSchema,
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  plaintextSha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  contentType: z.literal("application/gzip"),
  encryptionAlgorithm: z.literal("AES-256-GCM"),
  contentIv: z.string().min(16).max(32),
  encryptionKey: z.string().min(40).max(64),
}).strict();
