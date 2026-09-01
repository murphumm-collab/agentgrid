import { z } from "zod";

export const agentIdSchema = z.string().min(3).max(120);

export const agentAuthenticationHeadersSchema = z.object({
  agentId: agentIdSchema.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  apiKey: z.string().min(8).max(128).regex(/^amp_[A-Za-z0-9_-]+$/),
}).strict();

export function parseAgentAuthentication(agentId: string, apiKey: string | null) {
  const parsed = agentAuthenticationHeadersSchema.safeParse({ agentId, apiKey });
  if (!parsed.success) throw new Error("AGENT_AUTHENTICATION_FAILED");
  return parsed.data;
}
