import { z } from "zod";

export const apiErrorIssueSchema = z.object({
  code: z.string().min(1).max(64),
  path: z.array(z.union([z.string().max(120), z.number().int().nonnegative()])).max(32),
  message: z.string().min(1).max(500),
}).strict();

export const apiErrorResponseSchema = z.object({
  error: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(120),
  issues: z.array(apiErrorIssueSchema).max(32).optional(),
}).strict();

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
