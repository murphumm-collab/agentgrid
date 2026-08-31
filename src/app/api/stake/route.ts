import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { createStakePosition } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";

export async function POST(request: NextRequest) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const body = await readJsonBody<{ owner: string; amount: number }>(request);
    const owner = body.owner;
    return NextResponse.json(await createStakePosition(owner, body.amount), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
