import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { closeRedisForTests, completeAgentJob, enqueueAgentJob, heartbeatAgentJob, leaseAgentJob } from "../src/lib/agent-queue";

async function main() {
  const suffix = randomUUID();
  const job = { id: `smoke:${suffix}`, role: "EXECUTOR" as const, kind: "EXECUTE_TASK", payload: { taskId: suffix }, createdAt: new Date().toISOString() };
  if (!await enqueueAgentJob(job)) throw new Error("QUEUE_ENQUEUE_FAILED");
  if (await enqueueAgentJob(job)) throw new Error("QUEUE_IDEMPOTENCY_FAILED");
  const leased = await leaseAgentJob("agent-smoke", "EXECUTOR", "0xAgentSmoke");
  if (leased?.job.id !== job.id) throw new Error("QUEUE_LEASE_FAILED");
  let wrongOwnerRejected = false;
  try { await heartbeatAgentJob(job.id, "agent-wrong"); } catch { wrongOwnerRejected = true; }
  if (!wrongOwnerRejected) throw new Error("QUEUE_LEASE_OWNERSHIP_FAILED");
  await heartbeatAgentJob(job.id, "agent-smoke");
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  const [renewedTtlMs, recoveryDeadline] = await Promise.all([
    redis.pTTL(`agentgrid:lease:${job.id}`),
    redis.zScore("agentgrid:leases", job.id),
  ]);
  if (renewedTtlMs <= 0 || recoveryDeadline === null || recoveryDeadline <= Date.now()) {
    throw new Error("QUEUE_HEARTBEAT_RECOVERY_INDEX_NOT_ATOMIC");
  }
  await completeAgentJob(job.id, "agent-smoke", { artifactHash: "sha256:smoke" });

  const crashOwner = `0x${suffix.replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`;
  const crashJob = {
    id: `smoke-crash:${suffix}`, role: "EXECUTOR" as const, kind: "EXECUTE_TASK",
    payload: { taskId: `crash-${suffix}`, executor: crashOwner }, createdAt: new Date().toISOString(),
  };
  if (!await enqueueAgentJob(crashJob)) throw new Error("QUEUE_CRASH_JOB_ENQUEUE_FAILED");
  const beforeCrash = await leaseAgentJob("agent-before-crash", "EXECUTOR", crashOwner);
  if (beforeCrash?.job.id !== crashJob.id) throw new Error("QUEUE_CRASH_JOB_INITIAL_LEASE_FAILED");
  await redis.del(`agentgrid:lease:${crashJob.id}`);
  await redis.zAdd("agentgrid:leases", [{ score: Date.now() - 1, value: crashJob.id }]);
  await redis.close();
  const recoveries = await Promise.all(Array.from({ length: 16 }, (_, index) => leaseAgentJob(`agent-after-crash-${index}`, "EXECUTOR", crashOwner)));
  if (recoveries.filter(Boolean).length !== 1) throw new Error("QUEUE_CONCURRENT_RECOVERY_DUPLICATED");
  const recovered = recoveries.find(Boolean);
  const recoveredOwner = `agent-after-crash-${recoveries.findIndex(Boolean)}`;
  if (recovered?.job.id !== crashJob.id) throw new Error("QUEUE_CRASH_JOB_NOT_RECOVERED");
  await completeAgentJob(crashJob.id, recoveredOwner, { recovered: true });

  console.log(JSON.stringify({ enqueued: true, idempotent: true, leased: true, heartbeat: true, heartbeatRecoveryIndexAtomic: true, wrongOwnerRejected, completed: true, crashedLeaseRecovered: true }));
  // A completed maintenance transaction can be rolled back by a reorg.
  // Concurrent schedulers must redrive exactly one job, then leave it alone.
  const redriven = await Promise.all(Array.from({ length: 16 }, () => enqueueAgentJob(crashJob, true)));
  if (redriven.filter(Boolean).length !== 1) throw new Error("QUEUE_CONCURRENT_REDRIVE_DUPLICATED");
  const afterReorg = await leaseAgentJob("agent-after-reorg", "EXECUTOR", crashOwner);
  if (afterReorg?.job.id !== crashJob.id) throw new Error("QUEUE_REORG_REDRIVE_FAILED");
  if (await enqueueAgentJob(crashJob, true)) throw new Error("QUEUE_ACTIVE_JOB_REDRIVEN");
  await completeAgentJob(crashJob.id, "agent-after-reorg", { recovered: true });
  console.log(JSON.stringify({ concurrentRedriveIdempotent: true, activeLeasePreserved: true }));
  await closeRedisForTests();
}

void main();
