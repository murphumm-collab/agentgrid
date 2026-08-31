import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { protocolSnapshot, registerAgent, registerAgentSchema } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { requirePublisherRequest } from "@/lib/auth";
import { readJsonBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await protocolSnapshot();
    return NextResponse.json({ agents: snapshot.agents.map(({ id, name, owner, role, capabilities, stake, reputation, completedTasks, online }) => ({ id, name, owner, role, capabilities, stake, reputation, completedTasks, online })) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = registerAgentSchema.parse(await readJsonBody(request));
    const owner = isProductionMode() ? await requirePublisherRequest(request, body.owner) : body.owner;
    const agent = await registerAgent({ ...body, owner });
    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
