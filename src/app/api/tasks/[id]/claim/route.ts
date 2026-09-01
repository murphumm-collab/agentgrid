import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { authenticateAgent, claimTask } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";
import { agentIdBodySchema } from "@/lib/agent-delivery-schema";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const { id } = await context.params;
    const body = agentIdBodySchema.parse(await readJsonBody(request));
    await authenticateAgent(body.agentId, request.headers.get("x-agent-key"), "tasks:claim");
    return NextResponse.json(await claimTask(id, body.agentId));
  } catch (error) {
    return apiError(error);
  }
}
