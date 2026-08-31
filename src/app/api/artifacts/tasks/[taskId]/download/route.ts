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

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await context.params;
    const body = await readJsonBody<{ agentId: string }>(request);
    const agent = await authenticateAgent(body.agentId, request.headers.get("x-agent-key"), "tests:submit");
    if (!roleCanLease(agent.role, "TESTER")) throw new Error("AGENT_ROLE_DENIED");
    const task = (await protocolSnapshot()).tasks.find((item) => item.id === taskId);
    if (!task || task.testerId?.toLowerCase() !== agent.owner.toLowerCase()) throw new Error("TESTER_ARTIFACT_ACCESS_DENIED");
    const [artifacts, hiddenTest] = await Promise.all([readyArtifactsForTask(taskId), hiddenTestForTask(taskId)]);
    const artifact = artifacts.find((candidate) => task.submission?.artifactHash.toLowerCase() === keccak256(stringToHex(`sha256:${candidate.plaintextSha256}`)).toLowerCase());
    if (!artifact) throw new Error("ARTIFACT_CHAIN_COMMITMENT_MISMATCH");
    return NextResponse.json({
      id: artifact.id, taskId, contentType: artifact.contentType, sizeBytes: artifact.sizeBytes,
      artifactHash: `sha256:${artifact.plaintextSha256}`, ciphertextHash: `sha256:${artifact.sha256}`,
      encryptionAlgorithm: artifact.encryptionAlgorithm, contentIv: artifact.contentIv,
      decryptionKey: openArtifactKey(artifact), downloadUrl: await createArtifactDownload(artifact.objectKey), expiresInSeconds: 300,
      hiddenTest: {
        artifactHash: `sha256:${hiddenTest.plaintextSha256}`, ciphertextHash: `sha256:${hiddenTest.sha256}`,
        encryptionAlgorithm: hiddenTest.encryptionAlgorithm, contentIv: hiddenTest.contentIv,
        decryptionKey: openArtifactKey(hiddenTest), downloadUrl: await createArtifactDownload(hiddenTest.objectKey),
        sizeBytes: hiddenTest.sizeBytes, contentType: hiddenTest.contentType,
      },
    });
  } catch (error) { return apiError(error); }
}
