import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { closeRedisForTests, completeAgentJob, enqueueAgentJob, heartbeatAgentJob, leaseAgentJob } from "../src/lib/agent-queue";

async function main() {
  const suffix = randomUUID();
  const job = { id: `smoke:${suffix}`, role: "EXECUTOR" as const, kind: "EXECUTE_TASK" as const, payload: { taskId: "1" }, createdAt: new Date().toISOString() };
  if (!await enqueueAgentJob(job)) throw new Error("QUEUE_ENQUEUE_FAILED");
  if (await enqueueAgentJob(job)) throw new Error("QUEUE_IDEMPOTENCY_FAILED");
  const leased = await leaseAgentJob("agent-smoke", "EXECUTOR", "0xAgentSmoke");
  if (leased?.job.id !== job.id) throw new Error("QUEUE_LEASE_FAILED");
  let wrongOwnerRejected = false;
  try { await heartbeatAgentJob(job.id, "agent-wrong"); } catch { wrongOwnerRejected = true; }
  if (!wrongOwnerRejected) throw new Error("QUEUE_LEASE_OWNERSHIP_FAILED");
  await heartbeatAgentJob(job.id, "agent-smoke");
  let invalidCompletionRejected = false;
  try { await completeAgentJob(job.id, "agent-smoke", { artifactHash: "sha256:smoke" }); }
  catch { invalidCompletionRejected = true; }
  if (!invalidCompletionRejected) throw new Error("QUEUE_INVALID_COMPLETION_ACCEPTED");
  await heartbeatAgentJob(job.id, "agent-smoke");
  const completionResult = { artifactHash: `sha256:${"a".repeat(64)}`, transactionHash: `0x${"b".repeat(64)}` };
  await completeAgentJob(job.id, "agent-smoke", completionResult);
  await completeAgentJob(job.id, "agent-smoke", completionResult);
  let conflictingCompletionRejected = false;
  try { await completeAgentJob(job.id, "agent-smoke", { ...completionResult, transactionHash: `0x${"e".repeat(64)}` }); }
  catch { conflictingCompletionRejected = true; }
  if (!conflictingCompletionRejected) throw new Error("QUEUE_CONFLICTING_COMPLETION_ACCEPTED");

  let invalidEnqueueRejected = false;
  try {
    await enqueueAgentJob({ ...job, id: `invalid:${suffix}`, kind: "UNKNOWN_JOB" } as never);
  } catch (error) { invalidEnqueueRejected = error instanceof Error; }
  if (!invalidEnqueueRejected) throw new Error("QUEUE_INVALID_JOB_ENQUEUED");

  const corruptId = `corrupt:${suffix}`;
  const corruptionRedis = createClient({ url: process.env.REDIS_URL });
  await corruptionRedis.connect();
  await corruptionRedis.set(`agentgrid:job:${corruptId}`, JSON.stringify({ id: corruptId, role: "EXECUTOR", kind: "UNKNOWN_JOB", payload: {}, createdAt: new Date().toISOString() }));
  await corruptionRedis.lPush("agentgrid:queue:EXECUTOR", corruptId);
  if (await leaseAgentJob("agent-corrupt", "EXECUTOR", "0xAgentSmoke")) throw new Error("QUEUE_CORRUPT_JOB_LEASED");
  if (!await corruptionRedis.exists(`agentgrid:done:${corruptId}`) || await corruptionRedis.exists(`agentgrid:lease:${corruptId}`)) {
    throw new Error("QUEUE_CORRUPT_JOB_NOT_QUARANTINED");
  }
  await corruptionRedis.close();

  const crashOwner = `0x${suffix.replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`;
  const crashJob = {
    id: `smoke-crash:${suffix}`, role: "EXECUTOR" as const, kind: "REVISE_TASK" as const,
    payload: { taskId: "2", executor: crashOwner }, createdAt: new Date().toISOString(),
  };
  if (!await enqueueAgentJob(crashJob)) throw new Error("QUEUE_CRASH_JOB_ENQUEUE_FAILED");
  const beforeCrash = await leaseAgentJob("agent-before-crash", "EXECUTOR", crashOwner);
  if (beforeCrash?.job.id !== crashJob.id) throw new Error("QUEUE_CRASH_JOB_INITIAL_LEASE_FAILED");
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  await redis.del(`agentgrid:lease:${crashJob.id}`);
  await redis.zAdd("agentgrid:leases", [{ score: Date.now() - 1, value: crashJob.id }]);
  await redis.close();
  const recovered = await leaseAgentJob("agent-after-crash", "EXECUTOR", crashOwner);
  if (recovered?.job.id !== crashJob.id) throw new Error("QUEUE_CRASH_JOB_NOT_RECOVERED");
  await completeAgentJob(crashJob.id, "agent-after-crash", { artifactHash: `sha256:${"c".repeat(64)}`, transactionHash: `0x${"d".repeat(64)}` });

  console.log(JSON.stringify({ enqueued: true, idempotent: true, leased: true, heartbeat: true, wrongOwnerRejected, completed: true, exactCompletionRetryAccepted: true, conflictingCompletionRejected, invalidCompletionRejected, invalidCompletionPreservedLease: true, invalidEnqueueRejected, corruptJobQuarantined: true, crashedLeaseRecovered: true }));
  await closeRedisForTests();
}

void main();
