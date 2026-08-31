import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { protocolSnapshot } from "@/lib/service";
import { requireAdmin } from "@/lib/admin";
import { isProductionMode } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (isProductionMode()) requireAdmin(request);
    return NextResponse.json(await protocolSnapshot());
  } catch (error) {
    return apiError(error);
  }
}
