import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { keccak256, stringToHex } from "viem";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { authenticateAgent } from "@/lib/service";
import { evaluationTaskForAgent, storeSignedTaskEvaluation } from "@/lib/store-postgres";
import { taskEvaluationReportSchema, verifyTaskEvaluationSignature } from "@/lib/task-evaluation";
import { readJsonBody } from "@/lib/request-body";

const submissionSchema = z.object({
  report: taskEvaluationReportSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();

async function assignedAgent(request: NextRequest, taskId: string) {
  if (!/^\d+$/.test(taskId)) throw new Error("TASK_ID_INVALID");
  const agentId = request.headers.get("x-agent-id") ?? "";
  const agent = await authenticateAgent(agentId, request.headers.get("x-agent-key"), "evaluations:submit");
  if (agent.role !== "EVALUATOR" && agent.role !== "BOTH") throw new Error("AGENT_ROLE_DENIED");
  const evaluation = await evaluationTaskForAgent(taskId, agent.owner);
  return { agentId, agent, evaluation };
}

export async function GET(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const { evaluation } = await assignedAgent(request, taskId);
    return NextResponse.json({ evaluation });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const { agentId, agent } = await assignedAgent(request, taskId);
    const input = submissionSchema.parse(await readJsonBody(request));
    const verified = await verifyTaskEvaluationSignature({ taskId, report: input.report, signature: input.signature as `0x${string}`, expectedAddress: agent.owner });
    const stored = await storeSignedTaskEvaluation({
      id: randomUUID(), taskId, evaluatorAgentId: agentId, evaluatorAddress: verified.signer,
      approve: input.report.approve, reportHash: verified.reportHash, report: input.report, signature: input.signature,
    });
    return NextResponse.json({ ...stored, signer: verified.signer, categoryHash: keccak256(stringToHex(input.report.category)) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
