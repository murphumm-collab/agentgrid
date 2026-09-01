import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { completeAgentJob } from "@/lib/agent-queue";
import { apiError } from "@/lib/http";
import { authenticateAgent } from "@/lib/service";
import { readJsonBody } from "@/lib/request-body";
import { jobIdPathParameterSchema } from "@/lib/path-parameters";
import { agentJobCompletionResultSchema } from "@/lib/agent-job-schema";

const schema = z.object({
  agentId: z.string().min(3).max(120),
  result: agentJobCompletionResultSchema,
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = jobIdPathParameterSchema.parse((await context.params).id);
    const input = schema.parse(await readJsonBody(request, 128 * 1024));
    await authenticateAgent(input.agentId, request.headers.get("x-agent-key"), "heartbeat:write");
    return NextResponse.json(await completeAgentJob(id, input.agentId, input.result));
  } catch (error) { return apiError(error); }
}
