import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { operationalQueueMetrics } from "@/lib/agent-queue";
import { apiError } from "@/lib/http";
import { operationalDatabaseMetrics } from "@/lib/store-postgres";
import { operationalAlerts } from "@/lib/operational-alerts";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const [database, queue] = await Promise.all([operationalDatabaseMetrics(), operationalQueueMetrics()]);
    const alerts = operationalAlerts(database, queue);
    return NextResponse.json({ time: new Date().toISOString(), status: alerts.length ? "degraded" : "ok", alerts, database, queue });
  } catch (error) { return apiError(error); }
}
