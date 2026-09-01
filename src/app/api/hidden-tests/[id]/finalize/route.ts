import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePublisherRequest } from "@/lib/auth";
import { verifyArtifactObject, verifyEncryptedArtifactPlaintext } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { finalizeHiddenTestManifest, hiddenTestManifest } from "@/lib/store-postgres";
import { readJsonBody } from "@/lib/request-body";
import { walletAddressSchema } from "@/lib/auth-schema";
import { hiddenTestFinalizeResponseSchema } from "@/lib/production-response-schema";
import { uuidPathParameterSchema } from "@/lib/path-parameters";

const schema = z.object({ publisher: walletAddressSchema }).strict();
const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = uuidPathParameterSchema.parse((await context.params).id);
    const input = schema.parse(await readJsonBody(request));
    const publisher = await requirePublisherRequest(request, input.publisher);
    const manifest = await hiddenTestManifest(id, publisher);
    if (manifest.status !== "PENDING") throw new Error("HIDDEN_TEST_MANIFEST_NOT_FINALIZABLE");
    await verifyArtifactObject(manifest);
    await verifyEncryptedArtifactPlaintext(manifest);
    const finalized = await finalizeHiddenTestManifest(id, publisher);
    return NextResponse.json(hiddenTestFinalizeResponseSchema.parse({ ...finalized, plaintextSha256: manifest.plaintextSha256 }), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
