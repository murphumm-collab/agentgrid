import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePublisherRequest } from "@/lib/auth";
import { sealArtifactKey } from "@/lib/artifact-crypto";
import { isProductionMode } from "@/lib/env";
import { apiError } from "@/lib/http";
import { createHiddenTestManifest } from "@/lib/store-postgres";
import { readJsonBody } from "@/lib/request-body";
import { hiddenTestUploadRequestSchema } from "@/lib/agent-delivery-schema";
import { hiddenTestUploadResponseSchema } from "@/lib/production-response-schema";

const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

export async function POST(request: NextRequest) {
  try {
    if (!isProductionMode()) throw new Error("HIDDEN_TEST_UPLOADS_REQUIRE_PRODUCTION_MODE");
    const input = hiddenTestUploadRequestSchema.parse(await readJsonBody(request));
    const publisher = await requirePublisherRequest(request, input.publisher);
    const id = randomUUID();
    const objectKey = `hidden-tests/${publisher.toLowerCase()}/${id}`;
    const sealed = sealArtifactKey(input.encryptionKey);
    const { encryptionKey: _key, publisher: _claimedPublisher, ...manifest } = input;
    void _key;
    void _claimedPublisher;
    await createHiddenTestManifest({ id, publisher, objectKey, ...manifest, ...sealed });
    return NextResponse.json(hiddenTestUploadResponseSchema.parse({ id }), { status: 201, headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
