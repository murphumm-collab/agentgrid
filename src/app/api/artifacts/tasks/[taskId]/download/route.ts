import { NextRequest, NextResponse } from "next/server";
import { createArtifactDownload } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { authenticateAgent } from "@/lib/service";
import { hiddenTestForTask, readyArtifactsForTask } from "@/lib/store-postgres";
import { openArtifactKey } from "@/lib/artifact-crypto";
import { protocolSnapshot } from "@/lib/service";
import { keccak256, stringToHex } from "viem";
import { readJsonBody } from "@/lib/request-body";
import { roleCanLease } from "@/lib/agent-roles";
import { encryptedArtifactAccess } from "@/lib/artifact-access";
import { agentIdBodySchema } from "@/lib/agent-delivery-schema";
import { onchainTaskIdPathParameterSchema } from "@/lib/path-parameters";

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const taskId = onchainTaskIdPathParameterSchema.parse((await context.params).taskId);
    const body = agentIdBodySchema.parse(await readJsonBody(request));
    const agent = await authenticateAgent(body.agentId, request.headers.get("x-agent-key"), "tests:submit");
    if (!roleCanLease(agent.role, "TESTER")) throw new Error("AGENT_ROLE_DENIED");
    const task = (await protocolSnapshot()).tasks.find((item) => item.id === taskId);
    const testerIds = task?.testerIds?.length ? task.testerIds : task?.testerId ? [task.testerId] : [];
    const shard = testerIds.findIndex((tester) => tester.toLowerCase() === agent.owner.toLowerCase());
    if (!task || shard < 0) throw new Error("TESTER_ARTIFACT_ACCESS_DENIED");
    const verificationShard = task.completionDefinition?.verificationPlan?.shards[shard];
    if (!verificationShard) throw new Error("VERIFICATION_SHARD_NOT_COMMITTED");
    const [artifacts, hiddenTest] = await Promise.all([readyArtifactsForTask(taskId), hiddenTestForTask(taskId)]);
    const artifact = artifacts.find((candidate) => task.submission?.artifactHash.toLowerCase() === keccak256(stringToHex(`sha256:${candidate.plaintextSha256}`)).toLowerCase());
    if (!artifact) throw new Error("ARTIFACT_CHAIN_COMMITMENT_MISMATCH");
    return NextResponse.json({
      id: artifact.id, taskId,
      ...encryptedArtifactAccess(artifact, { decryptionKey: openArtifactKey(artifact), downloadUrl: await createArtifactDownload(artifact.objectKey) }),
      verificationShard,
      hiddenTest: encryptedArtifactAccess(hiddenTest, { decryptionKey: openArtifactKey(hiddenTest), downloadUrl: await createArtifactDownload(hiddenTest.objectKey) }),
    });
  } catch (error) { return apiError(error); }
}
