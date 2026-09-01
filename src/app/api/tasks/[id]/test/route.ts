import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { authenticateAgent, softwareEvidenceSchema, submitTest } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";
import { roleCanLease } from "@/lib/agent-roles";
import { z } from "zod";

const schema = z.object({
  testerId: z.string().min(3).max(120),
  evidence: softwareEvidenceSchema,
  selectionProof: z.string().min(1).max(500),
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const { id } = await context.params;
    const body = schema.parse(await readJsonBody(request));
    const agent = await authenticateAgent(body.testerId, request.headers.get("x-agent-key"), "tests:submit");
    if (!roleCanLease(agent.role, "TESTER")) throw new Error("AGENT_ROLE_DENIED");
    return NextResponse.json(await submitTest(id, body.testerId, body.evidence, body.selectionProof));
  } catch (error) {
    return apiError(error);
  }
}
