import { z } from "zod";

export const completedTaskQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(160).optional(),
  category: z.string().trim().min(2).max(64).optional(),
  executionMode: z.enum(["COLLABORATION", "COMPETITION"]).optional(),
}).strict();

export function parseCompletedTaskQuery(searchParams: URLSearchParams) {
  const input: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(input, key)) throw new Error("QUERY_PARAMETER_DUPLICATE");
    input[key] = value;
  }
  return completedTaskQuerySchema.parse(input);
}

export function completedTaskPageStart(taskIds: string[], cursor?: string) {
  if (!cursor) return 0;
  const index = taskIds.indexOf(cursor);
  if (index < 0) throw new Error("COMPLETED_TASK_CURSOR_INVALID");
  return index + 1;
}
