import { NextRequest, NextResponse } from "next/server";
import { requirePublisherRequest } from "@/lib/auth";
import { uploadArtifactObject } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { hiddenTestManifest } from "@/lib/store-postgres";
import { readBinaryBody } from "@/lib/request-body";
import { hiddenTestContentResponseSchema } from "@/lib/production-response-schema";
import { uuidPathParameterSchema } from "@/lib/path-parameters";

const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = uuidPathParameterSchema.parse((await context.params).id);
    const publisher = await requirePublisherRequest(request);
    const manifest = await hiddenTestManifest(id, publisher);
    if (manifest.status !== "PENDING") throw new Error("HIDDEN_TEST_MANIFEST_NOT_UPLOADABLE");
    if (manifest.sizeBytes > 10 * 1024 * 1024) throw new Error("ARTIFACT_SIZE_LIMIT_EXCEEDED");
    const bytes = await readBinaryBody(request, manifest.sizeBytes, manifest.sizeBytes);
    await uploadArtifactObject({ objectKey: manifest.objectKey, sha256: manifest.sha256, contentType: manifest.contentType, bytes });
    return NextResponse.json(hiddenTestContentResponseSchema.parse({ uploaded: true }), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
