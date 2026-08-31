import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { authenticateAgent, submitWork } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const { id } = await context.params;
    const body = await readJsonBody<{ agentId: string; artifactUrl: string; artifactHash: string; summary: string }>(request);
    await authenticateAgent(body.agentId, request.headers.get("x-agent-key"), "tasks:submit");
    return NextResponse.json(
      await submitWork(id, body.agentId, {
        artifactUrl: body.artifactUrl,
        artifactHash: body.artifactHash,
        summary: body.summary,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
