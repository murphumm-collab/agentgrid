import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { refreshTaskCredit } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";
import { z } from "zod";

const schema = z.object({ owner: z.string().min(3).max(120) }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const { id } = await context.params;
    const body = schema.parse(await readJsonBody(request));
    const owner = body.owner;
    return NextResponse.json(await refreshTaskCredit(owner, id));
  } catch (error) {
    return apiError(error);
  }
}
