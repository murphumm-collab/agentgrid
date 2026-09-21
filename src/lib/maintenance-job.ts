import type { AgentJob } from "./agent-queue";

/** Inputs must all be read at the same confirmed canonical block. */
export function maintenanceJob(input: {
  chainId: number; registry: string; taskId: string; state: number; tester: string;
  workRound: number; artifactHash: string; startedAt: bigint; approved: readonly boolean[]; now: bigint;
}): AgentJob | null {
  if (input.state !== 8 || input.startedAt === BigInt(0) || /^0x0{40}$/i.test(input.tester)) return null;
  const days = [0, 7, 30, 90];
  for (const checkpoint of [1, 2, 3]) {
    if (input.approved[checkpoint]) continue;
    const dueAt = input.startedAt + BigInt(days[checkpoint] * 86400);
    if (input.now < dueAt) return null;
    return {
      id: `maintenance:${input.chainId}:${input.registry.toLowerCase()}:${input.taskId}:${input.startedAt}:${input.workRound}:${input.tester.toLowerCase()}:${input.artifactHash}:${checkpoint}`,
      role: "TESTER", kind: "MAINTENANCE_VALIDATION",
      payload: { taskId: input.taskId, checkpoint, tester: input.tester, workRound: input.workRound, artifactHash: input.artifactHash, dueAt: dueAt.toString() },
      createdAt: new Date(Number(input.now) * 1000).toISOString(),
    };
  }
  return null;
}
