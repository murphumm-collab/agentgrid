import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { createTask, protocolSnapshot } from "@/lib/service";
import { isProductionMode } from "@/lib/env";
import { createTaskSchema } from "@/lib/service";
import { readJsonBody } from "@/lib/request-body";
import { publicTaskView } from "@/lib/public-task-view";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await protocolSnapshot();
    const rewards = new Map(snapshot.rewards.map((reward) => [reward.taskId, reward]));
    return NextResponse.json({ tasks: snapshot.tasks.filter((task) => task.state !== "EVALUATING" && task.evaluation?.status !== "REJECTED").map((task) => publicTaskView(task, rewards.get(task.id))) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (isProductionMode()) throw new Error("ONCHAIN_ACTION_REQUIRED");
    const body = createTaskSchema.parse(await readJsonBody(request));
    const publisher = body.publisher;
    return NextResponse.json(await createTask({ ...body, publisher }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
