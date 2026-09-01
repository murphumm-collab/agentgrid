import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { protocolSnapshot, registerAgent, registerAgentSchema } from "@/lib/service";
import { initialAgentQuality } from "@/lib/chain-projection";
import { isProductionMode } from "@/lib/env";
import { requirePublisherRequest } from "@/lib/auth";
import { readJsonBody } from "@/lib/request-body";
import { audit, enforceRateLimit, requestId } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await protocolSnapshot();
    return NextResponse.json({ agents: snapshot.agents.map(({ id, name, owner, role, capabilities, stake, reputation, completedTasks, online, quality }) => ({ id, name, owner, role, capabilities, stake, reputation, completedTasks, online, quality: quality ?? initialAgentQuality() })) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = registerAgentSchema.parse(await readJsonBody(request));
    const owner = isProductionMode() ? await requirePublisherRequest(request, body.owner) : body.owner;
    await enforceRateLimit(`agent-registration:${owner.toLowerCase()}`, 6, 60);
    await audit({
      actor: owner,
      action: "agent.registration.requested",
      target: body.stakePositionId,
      requestId: requestId(request),
    });
    const registration = await registerAgent({ ...body, owner });
    return NextResponse.json(registration, { status: registration.recovered ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
