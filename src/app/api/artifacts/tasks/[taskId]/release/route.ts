import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, readWalletSession } from "@/lib/auth";
import { assertPublisherArtifactRelease } from "@/lib/artifact-access";
import { openArtifactKey } from "@/lib/artifact-crypto";
import { createArtifactDownload } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { protocolSnapshot } from "@/lib/service";
import { readyArtifactsForTask, recordArtifactRelease } from "@/lib/store-postgres";
import { keccak256, stringToHex } from "viem";

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    assertSameOrigin(request);
    const { taskId } = await context.params;
    const session = await readWalletSession();
    if (!session) throw new Error("AUTHENTICATION_REQUIRED");
    const task = (await protocolSnapshot()).tasks.find((item) => item.id === taskId);
    assertPublisherArtifactRelease({ task, sessionAddress: session.address });
    const artifacts = await readyArtifactsForTask(taskId);
    const artifact = artifacts.find((candidate) => task?.submission?.artifactHash.toLowerCase() === keccak256(stringToHex(`sha256:${candidate.plaintextSha256}`)).toLowerCase());
    if (!artifact) throw new Error("ARTIFACT_CHAIN_COMMITMENT_MISMATCH");
    assertPublisherArtifactRelease({ task, sessionAddress: session.address, plaintextSha256: artifact.plaintextSha256 });
    const releaseId = randomUUID();
    const expiresInSeconds = 300;
    await recordArtifactRelease({
      id: releaseId,
      taskId,
      artifactId: artifact.id,
      publisher: session.address,
      chainState: task!.state as "MAINTENANCE" | "COMPLETED",
      artifactHash: `sha256:${artifact.plaintextSha256}`,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1_000),
    });
    return NextResponse.json({
      releaseId,
      artifactHash: `sha256:${artifact.plaintextSha256}`, ciphertextHash: `sha256:${artifact.sha256}`,
      contentType: artifact.contentType, encryptionAlgorithm: artifact.encryptionAlgorithm, contentIv: artifact.contentIv,
      decryptionKey: openArtifactKey(artifact), downloadUrl: await createArtifactDownload(artifact.objectKey), expiresInSeconds,
    });
  } catch (error) { return apiError(error); }
}
