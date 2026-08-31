import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePublisherRequest } from "@/lib/auth";
import { verifyArtifactObject, verifyEncryptedArtifactPlaintext } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { finalizeHiddenTestManifest, hiddenTestManifest } from "@/lib/store-postgres";
import { readJsonBody } from "@/lib/request-body";

const schema = z.object({ publisher: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = schema.parse(await readJsonBody(request));
    const publisher = await requirePublisherRequest(request, input.publisher);
    const manifest = await hiddenTestManifest(id, publisher);
    if (manifest.status !== "PENDING") throw new Error("HIDDEN_TEST_MANIFEST_NOT_FINALIZABLE");
    await verifyArtifactObject(manifest);
    await verifyEncryptedArtifactPlaintext(manifest);
    const finalized = await finalizeHiddenTestManifest(id, publisher);
    return NextResponse.json({ ...finalized, plaintextSha256: manifest.plaintextSha256 });
  } catch (error) { return apiError(error); }
}
