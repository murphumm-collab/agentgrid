import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { completeMaintenance } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const { id } = await context.params;
    const body = await readJsonBody<{ publisher: string; checkpointIndex: number; healthy: boolean }>(request);
    const publisher = body.publisher;
    return NextResponse.json(await completeMaintenance(id, publisher, body.checkpointIndex, body.healthy));
  } catch (error) {
    return apiError(error);
  }
}
