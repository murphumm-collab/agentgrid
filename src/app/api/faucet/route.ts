import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { faucet } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";

export async function POST(request: NextRequest) {
  try {
    if (isProductionMode()) throw new Error("LOCAL_FAUCET_DISABLED_IN_PRODUCTION");
    const body = await readJsonBody<{ owner: string; amount?: number }>(request);
    return NextResponse.json(await faucet(body.owner, body.amount), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
