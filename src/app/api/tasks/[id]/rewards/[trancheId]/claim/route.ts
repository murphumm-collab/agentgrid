import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { claimReward } from "@/lib/service";
import { isProductionMode } from "@/lib/env";

export async function POST(_request: Request, context: { params: Promise<{ id: string; trancheId: string }> }) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const { id, trancheId } = await context.params;
    return NextResponse.json(await claimReward(id, trancheId));
  } catch (error) {
    return apiError(error);
  }
}
