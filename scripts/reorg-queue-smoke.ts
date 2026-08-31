import { randomBytes, randomUUID } from "node:crypto";
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
      blockTimestamp: "2026-01-01T00:00:00.000Z",
      address: contractAddress,
      topics: [],
      data: "0x",
      eventName: "TaskEvaluatorsAssigned",
      eventArgs: { taskId: "42", evaluator0: owners[0], evaluator1: owners[1], evaluator2: owners[2] },
    }]);
    if ((await store.readChainProjectionRows()).events[0]?.blockTimestamp !== "2026-01-01 00:00:00+00") throw new Error("REORG_SMOKE_BLOCK_TIMESTAMP_NOT_PERSISTED");
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
      blockTimestamp: "2026-01-01T00:05:00.000Z",
      address: contractAddress,
      topics: [],
      data: "0x",
      eventName: "TaskEvaluatorsAssigned",
      eventArgs: { taskId: "43", evaluator0: owners[3], evaluator1: owners[4], evaluator2: owners[5] },
    }]);
    if ((await store.readChainProjectionRows()).events[0]?.blockTimestamp !== "2026-01-01 00:05:00+00") throw new Error("REORG_SMOKE_REPLACEMENT_TIMESTAMP_NOT_PERSISTED");
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

    const capabilityTaskId = "77";
    const capabilitySpecHash = `0x${randomBytes(32).toString("hex")}`;
    const hiddenTestId = randomUUID();
    const hiddenPlaintext = randomBytes(32).toString("hex");
    await store.createHiddenTestManifest({
      id: hiddenTestId, publisher: owners[6], objectKey: `hidden/${hiddenTestId}`, sha256: randomBytes(32).toString("hex"),
      plaintextSha256: hiddenPlaintext, sizeBytes: 1, contentType: "application/gzip", encryptionAlgorithm: "AES-256-GCM",
      contentIv: "iv", sealedKey: "key", sealIv: "seal-iv", sealTag: "seal-tag",
    });
    await store.finalizeHiddenTestManifest(hiddenTestId, owners[6]);
    await store.createTaskCommitment({ id: randomUUID(), publisher: owners[6], specHash: capabilitySpecHash, spec: {
      stakePositionId: 1, title: "Capability mismatch smoke task", description: "Proves a chain reorganization cannot revive a task with a weaker tester capability mask.",
      category: "Development", executionMode: "COLLABORATION", maxExecutors: 1, declaredDurationHours: 24,
      criteria: ["All hidden tests pass", "The production build succeeds"], requestedReward: 100,
      hiddenTestManifestId: hiddenTestId, hiddenTestPlaintextSha256: hiddenPlaintext,
      completionDefinition: {
        version: "AGENTGRID_TASK_DEFINITION_V1", targetUsers: "Operations owner responsible for approving the deployed workflow",
        deliverables: ["A runnable monitored service"], constraints: ["No production secrets"], outOfScope: ["Mainnet deployment"], assumptions: [], aiReviews: [],
        acceptanceCriteria: [
          { id: "criterion-1", description: "All hidden tests pass", verificationMethod: "Run the sealed test bundle", evidenceRequired: "Signed manifest and metrics", passCondition: "Zero failures", verificationType: "AUTOMATED_TEST", required: true },
          { id: "criterion-2", description: "The production build succeeds", verificationMethod: "Run the production build", evidenceRequired: "Signed exit code", passCondition: "Exit code equals zero", verificationType: "AUTOMATED_TEST", required: true },
        ],
      },
    } });
    const capabilityBlockHash = `0x${randomBytes(32).toString("hex")}`;
    const capabilityTransactionHash = `0x${randomBytes(32).toString("hex")}`;
    await store.persistChainBatch(cursorName, 101n, 102n, capabilityBlockHash, [
      { chainId: 97, transactionHash: capabilityTransactionHash, logIndex: 0, blockNumber: 101n, blockHash: capabilityBlockHash, blockTimestamp: "2026-01-01T00:06:00.000Z", address: contractAddress, topics: [], data: "0x", eventName: "TaskEvaluationRequested", eventArgs: { taskId: capabilityTaskId, publisher: owners[6], positionId: "1", specHash: capabilitySpecHash, selectionBlock: "106", candidateSetHash: `0x${randomBytes(32).toString("hex")}`, candidateCount: 3, deadline: "1767229560" } },
      { chainId: 97, transactionHash: capabilityTransactionHash, logIndex: 1, blockNumber: 101n, blockHash: capabilityBlockHash, blockTimestamp: "2026-01-01T00:06:00.000Z", address: contractAddress, topics: [], data: "0x", eventName: "TaskTesterCapabilitiesSet", eventArgs: { taskId: capabilityTaskId, requiredCapabilities: 2 } },
      { chainId: 97, transactionHash: capabilityTransactionHash, logIndex: 2, blockNumber: 101n, blockHash: capabilityBlockHash, blockTimestamp: "2026-01-01T00:06:00.000Z", address: contractAddress, topics: [], data: "0x", eventName: "TaskEvaluationFinalized", eventArgs: { taskId: capabilityTaskId, approved: true } },
      { chainId: 97, transactionHash: capabilityTransactionHash, logIndex: 3, blockNumber: 101n, blockHash: capabilityBlockHash, blockTimestamp: "2026-01-01T00:06:00.000Z", address: contractAddress, topics: [], data: "0x", eventName: "TaskCreated", eventArgs: { taskId: capabilityTaskId, publisher: owners[6], positionId: "1", specHash: capabilitySpecHash } },
    ]);
    let capabilityCommitment = (await store.readChainProjectionRows()).commitments.find((item) => item.specHash === capabilitySpecHash);
    if (capabilityCommitment?.status !== "REJECTED") throw new Error("REORG_SMOKE_CAPABILITY_MISMATCH_NOT_REJECTED");
    await store.rewindChain(cursorName, 102n);
    capabilityCommitment = (await store.readChainProjectionRows()).commitments.find((item) => item.specHash === capabilitySpecHash);
    if (capabilityCommitment?.status !== "REJECTED") throw new Error("REORG_SMOKE_CAPABILITY_MISMATCH_REVIVED");
    if ((await store.pendingJobOutbox()).some((job) => String(job.payload.taskId) === capabilityTaskId)) throw new Error("REORG_SMOKE_CAPABILITY_MISMATCH_JOB_RETAINED");

    console.log(JSON.stringify({
      schemaIsolated: true,
      exactChainProvenance: true,
      canonicalBlockTimestamp: true,
      orphanedOutboxDeleted: true,
      queuedOrphansDiscarded: true,
      inFlightOrphanCancelled: true,
      canonicalReplacementExecuted: true,
      mismatchedLogRejected: true,
      capabilityMismatchRejectedAfterRebuild: true,
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
