import { NextRequest, NextResponse } from "next/server";
import { requirePublisherRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { markNotificationRead } from "@/lib/store-postgres";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const address = await requirePublisherRequest(request);
    return NextResponse.json(await markNotificationRead(id, address));
  } catch (error) { return apiError(error); }
}
