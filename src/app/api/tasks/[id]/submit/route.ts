import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { authenticateAgent, submitWork } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";
import { z } from "zod";

const schema = z.object({
  agentId: z.string().min(3).max(120),
  artifactUrl: z.string().url().max(2_048),
  artifactHash: z.string().startsWith("sha256:").max(160),
  summary: z.string().min(1).max(4_000),
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const { id } = await context.params;
    const body = schema.parse(await readJsonBody(request));
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
