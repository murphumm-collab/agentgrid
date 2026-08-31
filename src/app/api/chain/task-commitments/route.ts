import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePublisherRequest } from "@/lib/auth";
import { isProductionMode } from "@/lib/env";
import { apiError } from "@/lib/http";
import { createTaskCommitment } from "@/lib/store-postgres";
import { taskSpecHash, taskSpecSchema } from "@/lib/task-commitment";
import { readJsonBody } from "@/lib/request-body";

export async function POST(request: NextRequest) {
  try {
    if (!isProductionMode()) throw new Error("CHAIN_COMMITMENTS_REQUIRE_PRODUCTION_MODE");
    const body = await readJsonBody<{ publisher: string } & Record<string, unknown>>(request);
    const publisher = await requirePublisherRequest(request, body.publisher);
    const spec = taskSpecSchema.parse(body);
    const specHash = taskSpecHash(spec);
    const commitment = await createTaskCommitment({ id: randomUUID(), publisher, specHash, spec });
    return NextResponse.json({ ...commitment, spec, requestedReward: spec.requestedReward }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
