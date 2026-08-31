import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sealArtifactObject, verifyArtifactObject, verifyEncryptedArtifactPlaintext } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { authenticateAgent, protocolSnapshot } from "@/lib/service";
import { artifactManifest, finalizeArtifactManifest } from "@/lib/store-postgres";
import { readJsonBody } from "@/lib/request-body";

const schema = z.object({ agentId: z.string().min(3).max(120) });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = schema.parse(await readJsonBody(request));
    const agent = await authenticateAgent(input.agentId, request.headers.get("x-agent-key"), "tasks:submit");
    const manifest = await artifactManifest(id, input.agentId);
    const task = (await protocolSnapshot()).tasks.find((item) => item.id === manifest.taskId);
    if (!task || !task.executorIds.some((executor) => executor.toLowerCase() === agent.owner.toLowerCase())) throw new Error("ARTIFACT_EXECUTOR_NOT_ASSIGNED");
    if (manifest.status === "READY") throw new Error("ARTIFACT_ALREADY_FINALIZED");
    await verifyArtifactObject(manifest);
    await verifyEncryptedArtifactPlaintext(manifest);
    const sealed = await sealArtifactObject(manifest);
    await finalizeArtifactManifest(id, input.agentId, sealed.objectKey);
    return NextResponse.json({ id, artifactUrl: sealed.artifactUrl, artifactHash: `sha256:${manifest.plaintextSha256}`, ciphertextHash: sealed.artifactHash, encrypted: true, sizeBytes: manifest.sizeBytes, contentType: manifest.contentType });
  } catch (error) { return apiError(error); }
}
