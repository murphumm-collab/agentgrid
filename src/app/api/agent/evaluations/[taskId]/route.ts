import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { keccak256, stringToHex } from "viem";
import { apiError } from "@/lib/http";
import { authenticateAgent } from "@/lib/service";
import { evaluationTaskForAgent, storeSignedTaskEvaluation } from "@/lib/store-postgres";
import { signedTaskEvaluationSubmissionSchema, taskEvaluationSigningVersion, verifyTaskEvaluationSignature } from "@/lib/task-evaluation";
import { readJsonBody } from "@/lib/request-body";
import { chainContractAddresses, runtimeConfig } from "@/lib/env";
import { onchainTaskIdPathParameterSchema } from "@/lib/path-parameters";

async function assignedAgent(request: NextRequest, rawTaskId: string) {
  const taskId = onchainTaskIdPathParameterSchema.parse(rawTaskId);
  const agentId = request.headers.get("x-agent-id") ?? "";
  const agent = await authenticateAgent(agentId, request.headers.get("x-agent-key"), "evaluations:submit");
  if (agent.role !== "EVALUATOR" && agent.role !== "BOTH") throw new Error("AGENT_ROLE_DENIED");
  const evaluation = await evaluationTaskForAgent(taskId, agent.owner);
  return { taskId, agentId, agent, evaluation };
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
    const assigned = await assignedAgent(request, taskId);
    const { taskId: parsedTaskId, agentId, agent } = assigned;
    const input = signedTaskEvaluationSubmissionSchema.parse(await readJsonBody(request));
    const configuredRegistry = chainContractAddresses().taskRegistry;
    if (input.chainId !== runtimeConfig().BSC_CHAIN_ID) throw new Error("SIGNING_CHAIN_MISMATCH");
    if (input.taskRegistry.toLowerCase() !== configuredRegistry.toLowerCase()) throw new Error("SIGNING_TASK_REGISTRY_MISMATCH");
    const verified = await verifyTaskEvaluationSignature({
      chainId: input.chainId, taskRegistry: input.taskRegistry, taskId: parsedTaskId, report: input.report,
      signature: input.signature as `0x${string}`, expectedAddress: agent.owner,
    });
    const stored = await storeSignedTaskEvaluation({
      id: randomUUID(), taskId: parsedTaskId, evaluatorAgentId: agentId, evaluatorAddress: verified.signer,
      approve: input.report.approve, reportHash: verified.reportHash, report: input.report, signature: input.signature,
      signingVersion: taskEvaluationSigningVersion, signingMessage: verified.message,
    });
    return NextResponse.json({ ...stored, signer: verified.signer, categoryHash: keccak256(stringToHex(input.report.category)) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
