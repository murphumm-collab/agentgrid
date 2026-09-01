import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { createStakePosition } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";
import { z } from "zod";

const schema = z.object({
  owner: z.string().min(3).max(120),
  amount: z.number().min(1_000).max(50_000),
}).strict();

export async function POST(request: NextRequest) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const body = schema.parse(await readJsonBody(request));
    const owner = body.owner;
    return NextResponse.json(await createStakePosition(owner, body.amount), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
