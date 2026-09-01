import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { faucet } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";
import { z } from "zod";

const schema = z.object({
  owner: z.string().min(3).max(120),
  amount: z.number().positive().max(50_000).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    if (isProductionMode()) throw new Error("LOCAL_FAUCET_DISABLED_IN_PRODUCTION");
    const body = schema.parse(await readJsonBody(request));
    return NextResponse.json(await faucet(body.owner, body.amount), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
