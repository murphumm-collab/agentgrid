import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePublisherRequest } from "@/lib/auth";
import { sealArtifactKey } from "@/lib/artifact-crypto";
import { isProductionMode } from "@/lib/env";
import { apiError } from "@/lib/http";
import { createHiddenTestManifest } from "@/lib/store-postgres";
import { readJsonBody } from "@/lib/request-body";

const schema = z.object({
  publisher: z.string().regex(/^0x[a-fA-F0-9]{40}$/), sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  plaintextSha256: z.string().regex(/^[0-9a-fA-F]{64}$/), sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
  contentType: z.literal("application/gzip"), encryptionAlgorithm: z.literal("AES-256-GCM"),
  contentIv: z.string().min(16).max(32), encryptionKey: z.string().min(40).max(64),
});

export async function POST(request: NextRequest) {
  try {
    if (!isProductionMode()) throw new Error("HIDDEN_TEST_UPLOADS_REQUIRE_PRODUCTION_MODE");
    const input = schema.parse(await readJsonBody(request));
    const publisher = await requirePublisherRequest(request, input.publisher);
    const id = randomUUID();
    const objectKey = `hidden-tests/${publisher.toLowerCase()}/${id}`;
    const sealed = sealArtifactKey(input.encryptionKey);
    const { encryptionKey: _key, publisher: _claimedPublisher, ...manifest } = input;
    void _key;
    void _claimedPublisher;
    await createHiddenTestManifest({ id, publisher, objectKey, ...manifest, ...sealed });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) { return apiError(error); }
}
