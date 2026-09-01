import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { isPublicTask, publicCompletedTask } from "@/lib/public-task-view";
import { protocolSnapshot } from "@/lib/service";
import { completedTaskPageStart, parseCompletedTaskQuery } from "@/lib/completed-task-query";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const query = parseCompletedTaskQuery(request.nextUrl.searchParams);
    const snapshot = await protocolSnapshot();
    let completed = snapshot.tasks.filter((task) => task.state === "COMPLETED" && isPublicTask(task));
    if (query.category) completed = completed.filter((task) => task.category === query.category);
    if (query.executionMode) completed = completed.filter((task) => task.executionMode === query.executionMode);
    completed.sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt) || b.id.localeCompare(a.id));
    const start = completedTaskPageStart(completed.map((task) => task.id), query.cursor);
    const page = completed.slice(start, start + query.limit);
    const rewardByTask = new Map(snapshot.rewards.map((reward) => [reward.taskId, reward]));
    return NextResponse.json({ tasks: page.map((task) => publicCompletedTask(task, rewardByTask.get(task.id))), nextCursor: start + page.length < completed.length ? page.at(-1)?.id ?? null : null }, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (error) { return apiError(error); }
}
