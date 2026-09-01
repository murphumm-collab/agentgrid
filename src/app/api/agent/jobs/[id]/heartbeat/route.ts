import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { heartbeatAgentJob } from "@/lib/agent-queue";
import { apiError } from "@/lib/http";
import { authenticateAgent } from "@/lib/service";
import { readJsonBody } from "@/lib/request-body";
import { jobIdPathParameterSchema } from "@/lib/path-parameters";

const schema = z.object({ agentId: z.string().min(3).max(120) }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = jobIdPathParameterSchema.parse((await context.params).id);
    const input = schema.parse(await readJsonBody(request));
    await authenticateAgent(input.agentId, request.headers.get("x-agent-key"), "heartbeat:write");
    return NextResponse.json(await heartbeatAgentJob(id, input.agentId));
  } catch (error) { return apiError(error); }
}
