import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { leaseAgentJob } from "@/lib/agent-queue";
import { apiError } from "@/lib/http";
import { authenticateAgent } from "@/lib/service";
import { readJsonBody } from "@/lib/request-body";
import { roleCanLease } from "@/lib/agent-roles";

const schema = z.object({ agentId: z.string().min(3), role: z.enum(["EXECUTOR", "TESTER", "EVALUATOR"]) });

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await readJsonBody(request));
    const scope = input.role === "EXECUTOR" ? "tasks:claim" : input.role === "TESTER" ? "tests:submit" : "evaluations:submit";
    const agent = await authenticateAgent(input.agentId, request.headers.get("x-agent-key"), scope);
    if (!roleCanLease(agent.role, input.role)) throw new Error("AGENT_ROLE_DENIED");
    return NextResponse.json(await leaseAgentJob(input.agentId, input.role, agent.owner));
  } catch (error) { return apiError(error); }
}
