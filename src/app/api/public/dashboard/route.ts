import { NextResponse } from "next/server";
import { buildAiDashboard } from "@/lib/ai-dashboard";
import { isProductionMode } from "@/lib/env";
import { apiError } from "@/lib/http";
import { protocolSnapshot } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dashboard = buildAiDashboard(await protocolSnapshot(), new Date(), isProductionMode() ? "production" : "demo");
    return NextResponse.json(dashboard, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
  } catch (error) {
    return apiError(error);
  }
}

