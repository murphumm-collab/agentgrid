import { NextRequest, NextResponse } from "next/server";
import { requirePublisherRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertAgentCredentialChainStatus, rotateAgentCredential, revokeAgentCredential } from "@/lib/service";
import { audit, enforceRateLimit, requestId } from "@/lib/security";
import { revokeAgentCredentialResponseSchema, rotateAgentCredentialResponseSchema } from "@/lib/production-response-schema";
import { agentIdPathParameterSchema } from "@/lib/path-parameters";

export const dynamic = "force-dynamic";
const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

async function authorize(request: NextRequest, id: string, action: "rotate" | "revoke") {
  const owner = await requirePublisherRequest(request);
  await enforceRateLimit(`agent-credential:${owner.toLowerCase()}`, 6, 60);
  await assertAgentCredentialChainStatus(id, owner, action === "rotate");
  await audit({
    actor: owner,
    action: `agent.credential.${action}.requested`,
    target: id,
    requestId: requestId(request),
  });
  return owner;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = agentIdPathParameterSchema.parse((await context.params).id);
    const owner = await authorize(request, id, "rotate");
    return NextResponse.json(rotateAgentCredentialResponseSchema.parse(await rotateAgentCredential(id, owner)), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = agentIdPathParameterSchema.parse((await context.params).id);
    const owner = await authorize(request, id, "revoke");
    return NextResponse.json(revokeAgentCredentialResponseSchema.parse(await revokeAgentCredential(id, owner)), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
