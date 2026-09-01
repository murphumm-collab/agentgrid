import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { reviewTask } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { readJsonBody } from "@/lib/request-body";
import { z } from "zod";

const rejectionSchema = z.object({
  code: z.string().min(1).max(80).optional(),
  criterionId: z.string().min(1).max(120).optional(),
  evidenceHash: z.string().startsWith("sha256:").max(160).optional(),
  detail: z.string().max(2_000).optional(),
}).strict();
const schema = z.object({
  publisher: z.string().min(3).max(120),
  decision: z.enum(["ACCEPT", "REJECT"]),
  rejection: rejectionSchema.optional(),
}).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const { id } = await context.params;
    const body = schema.parse(await readJsonBody(request));
    const publisher = body.publisher;
    return NextResponse.json(await reviewTask(id, publisher, body.decision, body.rejection));
  } catch (error) {
    return apiError(error);
  }
}
