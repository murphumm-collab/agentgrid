import { NextRequest, NextResponse } from "next/server";
import { requirePublisherRequest } from "@/lib/auth";
import { uploadArtifactObject } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { hiddenTestManifest } from "@/lib/store-postgres";
import { readBinaryBody } from "@/lib/request-body";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const claimedPublisher = request.headers.get("x-publisher") ?? undefined;
    const publisher = await requirePublisherRequest(request, claimedPublisher);
    const manifest = await hiddenTestManifest(id, publisher);
    if (manifest.status !== "PENDING") throw new Error("HIDDEN_TEST_MANIFEST_NOT_UPLOADABLE");
    const declaredLength = request.headers.get("content-length");
    if (declaredLength && Number(declaredLength) !== manifest.sizeBytes) throw new Error("ARTIFACT_SIZE_MISMATCH");
    if (manifest.sizeBytes > 10 * 1024 * 1024) throw new Error("ARTIFACT_SIZE_LIMIT_EXCEEDED");
    const bytes = await readBinaryBody(request, manifest.sizeBytes);
    if (bytes.byteLength !== manifest.sizeBytes) throw new Error("ARTIFACT_SIZE_MISMATCH");
    await uploadArtifactObject({ objectKey: manifest.objectKey, sha256: manifest.sha256, contentType: manifest.contentType, bytes });
    return NextResponse.json({ uploaded: true });
  } catch (error) { return apiError(error); }
}
