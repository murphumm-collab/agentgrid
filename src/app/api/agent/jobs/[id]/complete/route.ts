import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { completeAgentJob } from "@/lib/agent-queue";
import { apiError } from "@/lib/http";
import { authenticateAgent } from "@/lib/service";
import { readJsonBody } from "@/lib/request-body";

const schema = z.object({ agentId: z.string().min(3), result: z.unknown().optional() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = schema.parse(await readJsonBody(request, 128 * 1024));
    if (input.result !== undefined && JSON.stringify(input.result).length > 64 * 1024) throw new Error("JOB_RESULT_TOO_LARGE");
    await authenticateAgent(input.agentId, request.headers.get("x-agent-key"), "heartbeat:write");
    return NextResponse.json(await completeAgentJob(id, input.agentId, input.result));
  } catch (error) { return apiError(error); }
}
