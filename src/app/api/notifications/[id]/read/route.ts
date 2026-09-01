import { NextRequest, NextResponse } from "next/server";
import { requirePublisherRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { markNotificationRead } from "@/lib/store-postgres";
import { notificationReadResponseSchema } from "@/lib/wallet-workflow-schema";
import { uuidPathParameterSchema } from "@/lib/path-parameters";
const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = uuidPathParameterSchema.parse((await context.params).id);
    const address = await requirePublisherRequest(request);
    return NextResponse.json(notificationReadResponseSchema.parse(await markNotificationRead(id, address)), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
