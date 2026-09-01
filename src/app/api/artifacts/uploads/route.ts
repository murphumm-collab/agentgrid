import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createArtifactUpload } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { authenticateAgent, protocolSnapshot } from "@/lib/service";
import { createArtifactManifest } from "@/lib/store-postgres";
import { isProductionMode } from "@/lib/env";
import { sealArtifactKey } from "@/lib/artifact-crypto";
import { readJsonBody } from "@/lib/request-body";
import { artifactUploadRequestSchema } from "@/lib/agent-delivery-schema";

export async function POST(request: NextRequest) {
  try {
    if (!isProductionMode()) throw new Error("ARTIFACT_UPLOADS_REQUIRE_PRODUCTION_MODE");
    const input = artifactUploadRequestSchema.parse(await readJsonBody(request));
    const agent = await authenticateAgent(input.agentId, request.headers.get("x-agent-key"), "tasks:submit");
    const task = (await protocolSnapshot()).tasks.find((item) => item.id === input.taskId);
    if (!task || !task.executorIds.some((executor) => executor.toLowerCase() === agent.owner.toLowerCase())) throw new Error("ARTIFACT_EXECUTOR_NOT_ASSIGNED");
    if (task.state !== "CLAIMED") throw new Error("TASK_NOT_ACCEPTING_ARTIFACTS");
    const id = randomUUID();
    const objectKey = `tasks/${encodeURIComponent(input.taskId)}/${id}`;
    const sealed = sealArtifactKey(input.encryptionKey);
    const { encryptionKey: _encryptionKey, ...manifest } = input;
    void _encryptionKey;
    await createArtifactManifest({ id, objectKey, ...manifest, ...sealed });
    return NextResponse.json({ id, objectKey, ...(await createArtifactUpload({ objectKey, ...input })) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
