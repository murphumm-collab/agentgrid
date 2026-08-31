import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { productionReleaseReadinessReport } from "@/lib/production-release-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json(await productionReleaseReadinessReport(), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
