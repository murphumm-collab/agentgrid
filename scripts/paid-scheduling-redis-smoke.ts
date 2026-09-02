import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient } from "redis";

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL_NOT_CONFIGURED");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  const databaseNumber = Number(new URL(redisUrl).pathname.slice(1));
  if (!Number.isInteger(databaseNumber) || databaseNumber <= 0) {
    throw new Error("PAID_SCHEDULING_SMOKE_REQUIRES_NONZERO_REDIS_DATABASE");
  }
  process.env.PROTOCOL_MODE ??= "demo";
  process.env.AUTH_ORIGIN ??= "http://localhost:3000";
  process.env.AUTH_SECRET ??= "paid-scheduling-redis-smoke-secret";
  const { closeRedisForTests, enqueueAgentJob, leaseAgentJob } = await import("../src/lib/agent-queue");
  const { closePostgresForTests, migratePostgres } = await import("../src/lib/store-postgres");
  const redis = createClient({ url: redisUrl });
  await redis.connect();
  await redis.flushDb();

  const owner = `0x${"1".repeat(40)}`;
  const now = new Date().toISOString();
  const marker = randomUUID();
  const standardJob = (id: string, taskId: string) => ({
    id, role: "EXECUTOR" as const, kind: "EXECUTE_TASK" as const,
    payload: { taskId }, createdAt: now,
  });
  const priorityBinding = JSON.stringify({
    schedulingClass: "PRIORITY_SCHEDULING",
    schedulingAttestationHash: `0x${"a".repeat(64)}`,
  });
  const seedPriority = async (id: string, taskId: string, binding = priorityBinding) => {
    await redis.set(`agentgrid:job:${id}`, JSON.stringify(standardJob(id, taskId)));
    await redis.set(`agentgrid:scheduling:${id}`, binding);
    await redis.lPush("agentgrid:queue:EXECUTOR:priority", id);
  };

  try {
    const exact = standardJob(`paid-scheduling:exact:${marker}`, "100");
    if (!await enqueueAgentJob(exact) || await enqueueAgentJob(exact)) throw new Error("PAID_SCHEDULING_EXACT_RETRY_FAILED");
    let jobConflict = false;
    try { await enqueueAgentJob({ ...exact, payload: { taskId: "101" } }); }
    catch (error) { jobConflict = error instanceof Error && error.message === "AGENT_JOB_ID_CONFLICT"; }
    if (!jobConflict) throw new Error("PAID_SCHEDULING_JOB_CONFLICT_ACCEPTED");
    await redis.set(`agentgrid:scheduling:${exact.id}`, priorityBinding);
    let bindingConflict = false;
    try { await enqueueAgentJob(exact); }
    catch (error) { bindingConflict = error instanceof Error && error.message === "AGENT_JOB_SCHEDULING_BINDING_CONFLICT"; }
    if (!bindingConflict) throw new Error("PAID_SCHEDULING_BINDING_CONFLICT_ACCEPTED");
    await redis.del(`agentgrid:job:${exact.id}`, `agentgrid:scheduling:${exact.id}`);
    await redis.lRem("agentgrid:queue:EXECUTOR", 0, exact.id);

    const targeted = {
      id: `paid-scheduling:targeted:${marker}`, role: "EXECUTOR" as const, kind: "REVISE_TASK" as const,
      payload: { taskId: "200", executor: owner }, createdAt: now,
    };
    await enqueueAgentJob(targeted);
    await seedPriority(`paid-scheduling:priority-target-check:${marker}`, "201");
    const targetedLease = await leaseAgentJob("paid-scheduling-targeted", "EXECUTOR", owner);
    if (targetedLease?.job.id !== targeted.id) throw new Error("PAID_SCHEDULING_TARGETED_NOT_FIRST");
    if (await redis.get("agentgrid:scheduling:executor:consecutive-priority") !== null) {
      throw new Error("PAID_SCHEDULING_TARGETED_MOVED_CURSOR");
    }

    await redis.flushDb();
    const legacyId = `paid-scheduling:legacy:${marker}`;
    const malformedId = `paid-scheduling:malformed:${marker}`;
    await redis.set(`agentgrid:job:${malformedId}`, JSON.stringify(standardJob(malformedId, "250")));
    await redis.set(`agentgrid:scheduling:${malformedId}`, "");
    await redis.lPush("agentgrid:queue:EXECUTOR", malformedId);
    await redis.set(`agentgrid:job:${legacyId}`, JSON.stringify(standardJob(legacyId, "251")));
    await redis.lPush("agentgrid:queue:EXECUTOR", legacyId);
    await redis.lRem("agentgrid:queue:EXECUTOR", 0, malformedId);
    await redis.rPush("agentgrid:queue:EXECUTOR", malformedId);
    const legacyLease = await leaseAgentJob("paid-scheduling-legacy", "EXECUTOR", owner);
    if (legacyLease?.job.id !== legacyId || !await redis.exists(`agentgrid:done:${malformedId}`)) {
      throw new Error("PAID_SCHEDULING_LEGACY_STANDARD_COMPATIBILITY_FAILED");
    }

    await redis.flushDb();
    const priorityIds = Array.from({ length: 4 }, (_, index) => `paid-scheduling:p${index + 1}:${marker}`);
    const standardIds = Array.from({ length: 2 }, (_, index) => `paid-scheduling:s${index + 1}:${marker}`);
    for (const [index, id] of priorityIds.entries()) await seedPriority(id, String(300 + index));
    for (const [index, id] of standardIds.entries()) await enqueueAgentJob(standardJob(id, String(400 + index)));
    const leasedIds = [];
    for (let index = 0; index < 6; index += 1) {
      const leased = await leaseAgentJob(`paid-scheduling-fair-${index}`, "EXECUTOR", owner);
      if (!leased) throw new Error("PAID_SCHEDULING_FAIRNESS_LEASE_MISSING");
      if ("schedulingClass" in leased.job || "schedulingAttestationHash" in leased.job) {
        throw new Error("PAID_SCHEDULING_BINDING_LEAKED");
      }
      leasedIds.push(leased.job.id);
    }
    if (JSON.stringify(leasedIds) !== JSON.stringify([priorityIds[0], priorityIds[1], priorityIds[2], standardIds[0], priorityIds[3], standardIds[1]])) {
      throw new Error(`PAID_SCHEDULING_FAIRNESS_FAILED:${leasedIds.join(",")}`);
    }

    await redis.flushDb();
    const invalidId = `paid-scheduling:invalid:${marker}`;
    const validId = `paid-scheduling:valid:${marker}`;
    await seedPriority(invalidId, "500", JSON.stringify({ schedulingClass: "STANDARD", schedulingAttestationHash: null }));
    await seedPriority(validId, "501");
    await redis.lRem("agentgrid:queue:EXECUTOR:priority", 0, invalidId);
    await redis.rPush("agentgrid:queue:EXECUTOR:priority", invalidId);
    const afterInvalid = await leaseAgentJob("paid-scheduling-invalid", "EXECUTOR", owner);
    if (afterInvalid?.job.id !== validId || !await redis.exists(`agentgrid:done:${invalidId}`)) {
      throw new Error("PAID_SCHEDULING_INVALID_BINDING_NOT_QUARANTINED");
    }
    if (await redis.get("agentgrid:scheduling:executor:consecutive-priority") !== "1") {
      throw new Error("PAID_SCHEDULING_INVALID_BINDING_MOVED_CURSOR");
    }

    await redis.flushDb();
    const recoveryId = `paid-scheduling:recovery:${marker}`;
    await seedPriority(recoveryId, "600");
    const beforeCrash = await leaseAgentJob("paid-scheduling-before-crash", "EXECUTOR", owner);
    if (beforeCrash?.job.id !== recoveryId) throw new Error("PAID_SCHEDULING_RECOVERY_INITIAL_LEASE_FAILED");
    await redis.del(`agentgrid:lease:${recoveryId}`);
    await redis.zAdd("agentgrid:leases", [{ score: Date.now() - 1, value: recoveryId }]);
    const recovered = await leaseAgentJob("paid-scheduling-after-crash", "EXECUTOR", owner);
    if (recovered?.job.id !== recoveryId) throw new Error("PAID_SCHEDULING_ORIGINAL_LANE_NOT_RECOVERED");

    await redis.flushDb();
    await migratePostgres();
    const transactionHash = `0x${marker.replaceAll("-", "").padEnd(64, "0").slice(0, 64)}`;
    const blockHash = `0x${"b".repeat(64)}`;
    const blockNumber = "9900000";
    const database = new Client({ connectionString: databaseUrl });
    const blocker = new Client({ connectionString: databaseUrl });
    await database.connect();
    await blocker.connect();
    try {
      await database.query(
        `INSERT INTO chain_events(chain_id,transaction_hash,log_index,block_number,block_hash,address,topics,data,event_name,event_args)
         VALUES(97,$1,0,$2,$3,$4,'[]'::jsonb,'0x','PaidSchedulingSmoke','{}'::jsonb)`,
        [transactionHash, blockNumber, blockHash, owner],
      );
      const lockExpiryId = `paid-scheduling:lock-expiry:${marker}`;
      const lockExpiryJob = {
        ...standardJob(lockExpiryId, "700"),
        payload: { taskId: "700", chainId: 97 as const, transactionHash, logIndex: 0, blockNumber },
      };
      await redis.set(`agentgrid:job:${lockExpiryId}`, JSON.stringify(lockExpiryJob));
      await redis.set(`agentgrid:scheduling:${lockExpiryId}`, priorityBinding);
      await redis.lPush("agentgrid:queue:EXECUTOR:priority", lockExpiryId);
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE chain_events IN ACCESS EXCLUSIVE MODE");
      const interruptedLease = leaseAgentJob("paid-scheduling-lock-expiry", "EXECUTOR", owner);
      for (let attempt = 0; attempt < 100 && !await redis.exists("agentgrid:scheduling:executor:lock"); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (!await redis.exists("agentgrid:scheduling:executor:lock")) throw new Error("PAID_SCHEDULING_LOCK_NOT_OBSERVED");
      await redis.del("agentgrid:scheduling:executor:lock");
      await blocker.query("COMMIT");
      let confirmationRejected = false;
      try { await interruptedLease; }
      catch (error) { confirmationRejected = error instanceof Error && error.message === "AGENT_JOB_SCHEDULING_CONFIRMATION_FAILED"; }
      if (!confirmationRejected
        || await redis.get("agentgrid:scheduling:executor:consecutive-priority") !== null
        || !await redis.exists(`agentgrid:lease:${lockExpiryId}`)
        || await redis.zScore("agentgrid:leases", lockExpiryId) === null) {
        throw new Error("PAID_SCHEDULING_EXPIRED_LOCK_MOVED_CURSOR");
      }
      await redis.del(`agentgrid:lease:${lockExpiryId}`);
      await redis.zAdd("agentgrid:leases", [{ score: Date.now() - 1, value: lockExpiryId }]);
      const afterLockExpiry = await leaseAgentJob("paid-scheduling-lock-recovery", "EXECUTOR", owner);
      if (afterLockExpiry?.job.id !== lockExpiryId) throw new Error("PAID_SCHEDULING_EXPIRED_LOCK_LEASE_NOT_RECOVERED");
      await database.query("DELETE FROM chain_events WHERE chain_id=97 AND transaction_hash=$1 AND log_index=0", [transactionHash]);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end();
      await database.query("DELETE FROM chain_events WHERE chain_id=97 AND transaction_hash=$1 AND log_index=0", [transactionHash]).catch(() => undefined);
      await database.end();
    }

    process.stdout.write(`${JSON.stringify({ exactBinding: true, legacyMissingBindingIsStandard: true, malformedBindingQuarantined: true, targetedFirst: true, fairness: "3:1", invalidBindingQuarantined: true, priorityRecovery: true, expiredLockCursorSafe: true, publicLeaseRedacted: true })}\n`);
  } finally {
    await redis.flushDb();
    await redis.close();
    await closeRedisForTests();
    await closePostgresForTests();
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
