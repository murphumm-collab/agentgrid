import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { reviewTask } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const { id } = await context.params;
    const body = await readJsonBody<{
      publisher: string;
      decision: "ACCEPT" | "REJECT";
      rejection?: { code?: string; criterionId?: string; evidenceHash?: string; detail?: string };
    }>(request);
    const publisher = body.publisher;
    return NextResponse.json(await reviewTask(id, publisher, body.decision, body.rejection));
  } catch (error) {
    return apiError(error);
  }
}
