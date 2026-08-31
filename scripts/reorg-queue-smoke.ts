import { randomBytes } from "node:crypto";
import { Pool } from "pg";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function address(seed: string, index: number) {
  return `0x${seed}${index.toString(16).padStart(2, "0")}`;
}

async function main() {
  const baseDatabaseUrl = required("REORG_SMOKE_DATABASE_URL");
  const redisUrl = required("REORG_SMOKE_REDIS_URL");
  const schema = `reorg_smoke_${randomBytes(8).toString("hex")}`;
  const seed = randomBytes(19).toString("hex");
  const owners = Array.from({ length: 7 }, (_, index) => address(seed, index + 1));
  const transactionHash = `0x${randomBytes(32).toString("hex")}`;
  const replacementTransactionHash = `0x${randomBytes(32).toString("hex")}`;
  const blockHash = `0x${randomBytes(32).toString("hex")}`;
  const replacementBlockHash = `0x${randomBytes(32).toString("hex")}`;
  const contractAddress = address(seed, 250);
  const cursorName = `reorg-smoke-${schema}`;
  const admin = new Pool({ connectionString: baseDatabaseUrl, max: 1 });
  let closePostgres: (() => Promise<void>) | undefined;
  let closeRedis: (() => Promise<void>) | undefined;

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const isolatedDatabaseUrl = new URL(baseDatabaseUrl);
    isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = isolatedDatabaseUrl.toString();
    process.env.REDIS_URL = redisUrl;
    process.env.PROTOCOL_MODE = "production";
    process.env.AUTH_SECRET ||= randomBytes(32).toString("hex");

    const store = await import("../src/lib/store-postgres");
    const queue = await import("../src/lib/agent-queue");
    closePostgres = store.closePostgresForTests;
    closeRedis = queue.closeRedisForTests;

    await store.migratePostgres();
    await store.chainCursor(cursorName, 100n);
    await store.persistChainBatch(cursorName, 100n, 101n, blockHash, [{
      chainId: 97,
      transactionHash,
      logIndex: 7,
      blockNumber: 100n,
      blockHash,
      address: contractAddress,
      topics: [],
      data: "0x",
      eventName: "TaskEvaluatorsAssigned",
      eventArgs: { taskId: "42", evaluator0: owners[0], evaluator1: owners[1], evaluator2: owners[2] },
    }]);
    if ((await store.pendingJobOutbox()).length !== 3) throw new Error("REORG_SMOKE_OUTBOX_NOT_CREATED");
    if (await queue.dispatchJobOutbox() !== 3) throw new Error("REORG_SMOKE_OUTBOX_NOT_DISPATCHED");

    const inFlight = await queue.leaseAgentJob("reorg-in-flight", "EVALUATOR", owners[0]);
    if (!inFlight || inFlight.job.payload.logIndex !== 7 || inFlight.job.payload.chainId !== 97) throw new Error("REORG_SMOKE_PROVENANCE_NOT_LEASED");
    await store.rewindChain(cursorName, 100n);
    let inFlightCancelled = false;
    try {
      await queue.heartbeatAgentJob(inFlight.job.id, "reorg-in-flight");
    } catch (error) {
      inFlightCancelled = error instanceof Error && error.message === "JOB_SOURCE_REWOUND";
    }
    if (!inFlightCancelled) throw new Error("REORG_SMOKE_IN_FLIGHT_NOT_CANCELLED");
    for (let index = 1; index <= 2; index += 1) {
      if (await queue.leaseAgentJob(`reorg-stale-${index}`, "EVALUATOR", owners[index])) throw new Error("REORG_SMOKE_QUEUED_ORPHAN_LEASED");
    }
    if (await store.canonicalChainJobEvent(transactionHash, "100", 97, 7)) throw new Error("REORG_SMOKE_ORPHAN_EVENT_RETAINED");
    if ((await store.pendingJobOutbox()).length !== 0) throw new Error("REORG_SMOKE_ORPHAN_OUTBOX_RETAINED");

    await store.persistChainBatch(cursorName, 100n, 101n, replacementBlockHash, [{
      chainId: 97,
      transactionHash: replacementTransactionHash,
      logIndex: 9,
      blockNumber: 100n,
      blockHash: replacementBlockHash,
      address: contractAddress,
      topics: [],
      data: "0x",
      eventName: "TaskEvaluatorsAssigned",
      eventArgs: { taskId: "43", evaluator0: owners[3], evaluator1: owners[4], evaluator2: owners[5] },
    }]);
    await queue.dispatchJobOutbox();
    for (let index = 3; index <= 5; index += 1) {
      const leased = await queue.leaseAgentJob(`reorg-canonical-${index}`, "EVALUATOR", owners[index]);
      if (!leased) throw new Error("REORG_SMOKE_CANONICAL_JOB_MISSING");
      await queue.heartbeatAgentJob(leased.job.id, `reorg-canonical-${index}`);
      await queue.completeAgentJob(leased.job.id, `reorg-canonical-${index}`, { smoke: true });
    }

    const mismatched = {
      id: `reorg-mismatched-log-${schema}`,
      role: "EVALUATOR" as const,
      kind: "EVALUATE_TASK",
      payload: { taskId: "43", tester: owners[6], chainId: 97, transactionHash: replacementTransactionHash, logIndex: 10, blockNumber: "100" },
      createdAt: new Date().toISOString(),
    };
    await queue.enqueueAgentJob(mismatched);
    if (await queue.leaseAgentJob("reorg-mismatched", "EVALUATOR", owners[6])) throw new Error("REORG_SMOKE_LOG_MISMATCH_ACCEPTED");

    console.log(JSON.stringify({
      schemaIsolated: true,
      exactChainProvenance: true,
      orphanedOutboxDeleted: true,
      queuedOrphansDiscarded: true,
      inFlightOrphanCancelled: true,
      canonicalReplacementExecuted: true,
      mismatchedLogRejected: true,
    }));
  } finally {
    await closeRedis?.();
    await closePostgres?.();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
