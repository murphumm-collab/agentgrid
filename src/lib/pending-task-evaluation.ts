import { z } from "zod";
import type { Hash, Hex } from "viem";

export const pendingTaskEvaluationSchema = z.object({
  positionId: z.string().regex(/^\d+$/),
  specHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value as Hex),
  requestedReward: z.string().regex(/^\d+(?:\.\d+)?$/),
  maxExecutors: z.number().int().min(1).max(32),
  executionMode: z.enum(["COLLABORATION", "COMPETITION"]),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value as Hash).optional(),
}).strict();

export type PendingTaskEvaluation = z.infer<typeof pendingTaskEvaluationSchema>;

export function parsePendingTaskEvaluation(value: unknown) {
  return pendingTaskEvaluationSchema.parse(value);
}
