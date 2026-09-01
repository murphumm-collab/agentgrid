import { NextRequest, NextResponse } from "next/server";
import { sealArtifactObject, verifyArtifactObject, verifyEncryptedArtifactPlaintext } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { authenticateAgent, protocolSnapshot } from "@/lib/service";
import { artifactManifest, finalizeArtifactManifest } from "@/lib/store-postgres";
import { readJsonBody } from "@/lib/request-body";
import { agentIdBodySchema } from "@/lib/agent-delivery-schema";
import { uuidPathParameterSchema } from "@/lib/path-parameters";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = uuidPathParameterSchema.parse((await context.params).id);
    const input = agentIdBodySchema.parse(await readJsonBody(request));
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
