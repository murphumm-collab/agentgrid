import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { pilotQualificationReport } from "@/lib/pilot-qualification-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json(await pilotQualificationReport(), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) { return apiError(error); }
}
