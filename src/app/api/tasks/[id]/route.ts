import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { protocolSnapshot } from "@/lib/service";
import { requirePublisherRequest } from "@/lib/auth";
import { publicTaskView } from "@/lib/public-task-view";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const snapshot = await protocolSnapshot();
    const task = snapshot.tasks.find((item) => item.id === id);
    if (!task) throw new Error("TASK_NOT_FOUND");
    if (task.state === "EVALUATING" || task.evaluation?.status === "REJECTED") await requirePublisherRequest(request, task.publisher);
    const reward = snapshot.rewards.find((item) => item.taskId === id) ?? null;
    return NextResponse.json({ task: publicTaskView(task, reward), reward: reward ? publicTaskView(task, reward).reward : null });
  } catch (error) {
    return apiError(error);
  }
}
