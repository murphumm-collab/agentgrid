import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { publicCompletedTask } from "@/lib/public-task-view";
import { protocolSnapshot } from "@/lib/service";

export const dynamic = "force-dynamic";
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(160).optional(), category: z.string().trim().min(2).max(64).optional(), executionMode: z.enum(["COLLABORATION", "COMPETITION"]).optional() });

export async function GET(request: NextRequest) {
  try {
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const snapshot = await protocolSnapshot();
    let completed = snapshot.tasks.filter((task) => task.state === "COMPLETED");
    if (query.category) completed = completed.filter((task) => task.category === query.category);
    if (query.executionMode) completed = completed.filter((task) => task.executionMode === query.executionMode);
    completed.sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt) || b.id.localeCompare(a.id));
    const start = query.cursor ? Math.max(0, completed.findIndex((task) => task.id === query.cursor) + 1) : 0;
    const page = completed.slice(start, start + query.limit);
    const rewardByTask = new Map(snapshot.rewards.map((reward) => [reward.taskId, reward]));
    return NextResponse.json({ tasks: page.map((task) => publicCompletedTask(task, rewardByTask.get(task.id))), nextCursor: start + page.length < completed.length ? page.at(-1)?.id ?? null : null }, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (error) { return apiError(error); }
}
