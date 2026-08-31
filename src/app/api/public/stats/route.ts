import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { publicTaskStatistics } from "@/lib/public-task-view";
import { protocolSnapshot } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await protocolSnapshot();
    return NextResponse.json(publicTaskStatistics(snapshot.tasks, snapshot.rewards), { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (error) { return apiError(error); }
}
