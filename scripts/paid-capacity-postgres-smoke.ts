import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { privateKeyToAccount } from "viem/accounts";

async function main() {
  const issuer = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
  process.env.PROTOCOL_MODE = "production";
  process.env.AUTH_ORIGIN ??= "http://localhost:3000";
  process.env.AUTH_SECRET ??= randomBytes(32).toString("hex");
  process.env.PAID_CAPACITY_ATTESTATION_SIGNER = issuer.address;
  for (const name of ["TOKEN_ADDRESS", "STAKE_MANAGER_ADDRESS", "AGENT_REGISTRY_ADDRESS", "TASK_REGISTRY_ADDRESS", "REWARD_VAULT_ADDRESS"] as const) {
    process.env[name] ??= `0x${String(["TOKEN_ADDRESS", "STAKE_MANAGER_ADDRESS", "AGENT_REGISTRY_ADDRESS", "TASK_REGISTRY_ADDRESS", "REWARD_VAULT_ADDRESS"].indexOf(name) + 1).repeat(40)}`;
  }
  const { runtimeConfig } = await import("../src/lib/env");
  const { createVerificationPlan } = await import("../src/lib/verification-panel");
  const { taskDefinitionReviewBindingHash, taskDefinitionVersion } = await import("../src/lib/task-definition");
  const { taskSpecHash, taskSpecSchema } = await import("../src/lib/task-commitment");
  const { requiredTesterCapabilityMask } = await import("../src/lib/agent-roles");
  const {
    chainCursor,
    closePostgresForTests,
    createTaskCommitment,
    persistChainBatch,
    storeTaskDefinitionReview,
  } = await import("../src/lib/store-postgres");
  const { importSignedPrioritySchedulingEntitlement } = await import("../src/lib/paid-capacity-service");
  const { paidCapacityEntitlementMessage, paidCapacityIsolationPolicy } = await import("../src/lib/paid-capacity-entitlement");

  const marker = randomUUID();
  const publisher = `0x${randomBytes(20).toString("hex")}`;
  const reviewId = randomUUID();
  const hiddenTestId = randomUUID();
  const commitmentId = randomUUID();
  const chainTaskId = String(Date.now());
  const cursorName = `paid-capacity-smoke:${marker}`;
  const hiddenHash = randomBytes(32).toString("hex");
  const definition = {
    version: taskDefinitionVersion,
    targetUsers: "Operators validating paid scheduling isolation",
    deliverables: ["Runnable service and deterministic verification evidence"],
    constraints: ["Paid scheduling changes only the general executor queue order"],
    outOfScope: ["Validator, evaluator, arbitrator, deadline, reward, and challenge changes"],
    assumptions: [],
    aiReviews: [],
    acceptanceCriteria: [
      { id: "criterion-1", description: "The service tests pass", verificationMethod: "Validators run the committed test suite", evidenceRequired: "Signed test output", passCondition: "Every committed test passes", required: true },
      { id: "criterion-2", description: "The service builds", verificationMethod: "Validators execute the production build", evidenceRequired: "Signed build output", passCondition: "The production build exits with code zero", required: true },
    ],
    verificationPlan: createVerificationPlan(["criterion-1", "criterion-2"]),
    collaborationPlan: {
      workPackages: [
        { slot: 1, title: "Implementation", objective: "Implement criterion-1", deliverables: ["Runnable implementation"], dependsOn: [], criterionIds: ["criterion-1"] },
        { slot: 2, title: "Build integration", objective: "Implement criterion-2", deliverables: ["Build integration"], dependsOn: [1], criterionIds: ["criterion-2"] },
      ],
      sharedInterfaces: ["Repository-relative source and test paths"],
      assemblyStrategy: "The lead integrates both committed work packages",
      underfilledStrategy: "The lead implements any unfilled work package",
      integrationChecks: ["criterion-1: Every committed test passes", "criterion-2: The production build exits with code zero"],
    },
  };
  const spec = taskSpecSchema.parse({
    definitionReviewId: reviewId,
    stakePositionId: 1,
    title: "Verify paid scheduling PostgreSQL lifecycle",
    description: "Create one exact entitlement, consume it once, and freeze only the first executor slot as priority.",
    category: "Development",
    executionMode: "COLLABORATION",
    maxExecutors: 2,
    declaredDurationHours: 1,
    criteria: definition.acceptanceCriteria.map((criterion) => criterion.description),
    completionDefinition: definition,
    requestedReward: 10,
    hiddenTestManifestId: hiddenTestId,
    hiddenTestPlaintextSha256: hiddenHash,
  });
  const specHash = taskSpecHash(spec);
  const client = new Client({ connectionString: runtimeConfig().DATABASE_URL });
  await client.connect();
  try {
    await storeTaskDefinitionReview({
      id: reviewId,
      publisher,
      reviewedTaskHash: taskDefinitionReviewBindingHash({
        title: spec.title,
        businessOutcome: spec.description,
        category: spec.category,
        executionMode: spec.executionMode,
        maxExecutors: spec.maxExecutors,
        completionDefinition: spec.completionDefinition,
      }),
      definitionHash: `0x${randomBytes(32).toString("hex")}`,
      recommendation: spec.completionDefinition,
      reviewers: [],
      assessment: { ready: true },
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    await client.query(
      `INSERT INTO hidden_test_manifests(id,publisher,object_key,sha256,plaintext_sha256,size_bytes,content_type,encryption_algorithm,content_iv,sealed_key,seal_iv,seal_tag,status)
       VALUES($1,$2,$3,$4,$5,1,'application/octet-stream','AES-256-GCM',$6,$7,$8,$9,'READY')`,
      [hiddenTestId, publisher.toLowerCase(), `paid-capacity-smoke/${marker}`, randomBytes(32).toString("hex"), hiddenHash,
        randomBytes(12).toString("hex"), randomBytes(32).toString("hex"), randomBytes(12).toString("hex"), randomBytes(16).toString("hex")],
    );
    const now = Date.now();
    const entitlement = {
      version: 1 as const,
      entitlementId: randomUUID(),
      chainId: 97 as const,
      taskRegistry: process.env.TASK_REGISTRY_ADDRESS!,
      publisher,
      issuer: issuer.address,
      receipt: {
        processor: "agentgrid-smoke",
        receiptId: `receipt:${marker}`,
        receiptHash: `sha256:${randomBytes(32).toString("hex")}`,
        amountAtomic: "1",
        settlementAsset: "USDC" as const,
        paidAt: new Date(now - 180_000).toISOString(),
      },
      issuedAt: new Date(now - 120_000).toISOString(),
      startsAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 60 * 60_000).toISOString(),
      isolation: paidCapacityIsolationPolicy,
      definitionReviewId: reviewId,
      specHash,
      kind: "PRIORITY_SCHEDULING" as const,
      effect: "EXECUTOR_GENERAL_QUEUE_ORDER_ONLY" as const,
      executorRecipientWeightsMayChange: false as const,
      prioritySlots: 1,
    };
    const signing = paidCapacityEntitlementMessage(entitlement);
    const signature = await issuer.signMessage({ message: signing.message });
    const imported = await importSignedPrioritySchedulingEntitlement({ entitlement, signature });
    if (!imported.stored || imported.attestationHash !== signing.entitlementHash) throw new Error("PAID_CAPACITY_SMOKE_IMPORT_FAILED");
    const commitment = await createTaskCommitment({ id: commitmentId, publisher, specHash, spec });
    if (commitment.id !== commitmentId) throw new Error("PAID_CAPACITY_SMOKE_COMMITMENT_FAILED");
    const frozen = await client.query<{ prioritySlots: number; attestationHash: string; consumedCommitmentId: string }>(
      `SELECT c.priority_slots AS "prioritySlots",c.priority_scheduling_attestation_hash AS "attestationHash",
              e.consumed_commitment_id::text AS "consumedCommitmentId"
       FROM task_commitments c JOIN paid_capacity_entitlements e ON e.attestation_hash=c.priority_scheduling_attestation_hash WHERE c.id=$1`,
      [commitmentId],
    );
    if (frozen.rows[0]?.prioritySlots !== 1 || frozen.rows[0].attestationHash !== signing.entitlementHash || frozen.rows[0].consumedCommitmentId !== commitmentId) {
      throw new Error("PAID_CAPACITY_SMOKE_NOT_FROZEN");
    }
    await client.query("UPDATE task_commitments SET status='APPROVED' WHERE id=$1", [commitmentId]);
    const fromBlock = BigInt(9_000_000 + Math.floor(Math.random() * 100_000));
    await chainCursor(cursorName, fromBlock);
    const expectProjectionBindingRejection = async (column: "publisher" | "spec_hash", value: string) => {
      const original = column === "publisher" ? publisher.toLowerCase() : specHash.toLowerCase();
      await client.query(`UPDATE paid_capacity_entitlements SET ${column}=$2 WHERE definition_review_id=$1`, [reviewId, value]);
      let rejected = false;
      try {
        const mismatchTransactionHash = `0x${randomBytes(32).toString("hex")}`;
        const mismatchBlockHash = `0x${randomBytes(32).toString("hex")}`;
        await persistChainBatch(cursorName, fromBlock, fromBlock + 1n, mismatchBlockHash, [{
          chainId: 97, transactionHash: mismatchTransactionHash, logIndex: 0, blockNumber: fromBlock, blockHash: mismatchBlockHash,
          blockTimestamp: new Date().toISOString(), address: process.env.TASK_REGISTRY_ADDRESS!, topics: [], data: "0x",
          eventName: "TaskCreated", eventArgs: { taskId: chainTaskId, publisher, specHash },
        }]);
      } catch (error) {
        rejected = error instanceof Error && error.message === "PAID_CAPACITY_ENTITLEMENT_BINDING_MISMATCH";
      } finally {
        await client.query(`UPDATE paid_capacity_entitlements SET ${column}=$2 WHERE definition_review_id=$1`, [reviewId, original]);
      }
      if (!rejected) throw new Error("PAID_CAPACITY_SMOKE_PROJECTION_BINDING_ACCEPTED");
    };
    await expectProjectionBindingRejection("publisher", `0x${"9".repeat(40)}`);
    await expectProjectionBindingRejection("spec_hash", `0x${"8".repeat(64)}`);
    const transactionHash = `0x${randomBytes(32).toString("hex")}`;
    const blockHash = `0x${randomBytes(32).toString("hex")}`;
    await persistChainBatch(cursorName, fromBlock, fromBlock + 1n, blockHash, [
      {
        chainId: 97, transactionHash, logIndex: 0, blockNumber: fromBlock, blockHash,
        blockTimestamp: new Date().toISOString(), address: process.env.TASK_REGISTRY_ADDRESS!, topics: [], data: "0x",
        eventName: "TaskTesterCapabilitiesSet", eventArgs: { taskId: chainTaskId, requiredCapabilities: requiredTesterCapabilityMask(spec.completionDefinition) },
      },
      {
        chainId: 97, transactionHash, logIndex: 1, blockNumber: fromBlock, blockHash,
        blockTimestamp: new Date().toISOString(), address: process.env.TASK_REGISTRY_ADDRESS!, topics: [], data: "0x",
        eventName: "TaskCreated", eventArgs: { taskId: chainTaskId, publisher, specHash },
      },
    ]);
    const jobs = await client.query<{ slot: string; schedulingClass: string; schedulingAttestationHash: string | null }>(
      `SELECT payload->>'slot' AS slot,scheduling_class AS "schedulingClass",scheduling_attestation_hash AS "schedulingAttestationHash"
       FROM job_outbox WHERE payload->>'taskId'=$1 ORDER BY (payload->>'slot')::int`,
      [chainTaskId],
    );
    if (jobs.rows.length !== 2
      || jobs.rows[0].schedulingClass !== "PRIORITY_SCHEDULING"
      || jobs.rows[0].schedulingAttestationHash !== signing.entitlementHash
      || jobs.rows[1].schedulingClass !== "STANDARD"
      || jobs.rows[1].schedulingAttestationHash !== null) throw new Error("PAID_CAPACITY_SMOKE_OUTBOX_FREEZE_FAILED");
    const expectConstraintRejection = async (id: string, role: string, kind: string, schedulingClass: string, hash: string | null) => {
      await client.query("BEGIN");
      let rejected = false;
      try {
        await client.query(
          `INSERT INTO job_outbox(id,role,kind,payload,scheduling_class,scheduling_attestation_hash)
           VALUES($1,$2,$3,$4::jsonb,$5,$6)`,
          [id, role, kind, JSON.stringify({ taskId: chainTaskId, slot: 99 }), schedulingClass, hash],
        );
      } catch { rejected = true; }
      await client.query("ROLLBACK");
      if (!rejected) throw new Error("PAID_CAPACITY_SMOKE_DATABASE_CONSTRAINT_MISSING");
    };
    await expectConstraintRejection(`invalid-standard:${marker}`, "EXECUTOR", "EXECUTE_TASK", "STANDARD", signing.entitlementHash);
    await expectConstraintRejection(`invalid-role:${marker}`, "COORDINATOR", "FINALIZE_TASK_EVALUATION", "PRIORITY_SCHEDULING", signing.entitlementHash);
    await expectConstraintRejection(`invalid-missing-hash:${marker}`, "EXECUTOR", "EXECUTE_TASK", "PRIORITY_SCHEDULING", null);
    await client.query("BEGIN");
    let partialCommitmentRejected = false;
    try {
      await client.query(
        `INSERT INTO task_commitments(id,publisher,spec_hash,spec,priority_scheduling_attestation_hash,priority_slots)
         VALUES($1,$2,$3,'{}'::jsonb,$4,NULL)`,
        [randomUUID(), publisher.toLowerCase(), `0x${randomBytes(32).toString("hex")}`, signing.entitlementHash],
      );
    } catch { partialCommitmentRejected = true; }
    await client.query("ROLLBACK");
    if (!partialCommitmentRejected) throw new Error("PAID_CAPACITY_SMOKE_PARTIAL_COMMITMENT_ACCEPTED");
    process.stdout.write(`${JSON.stringify({ imported: true, consumedOnce: true, frozenPrioritySlots: 1, priorityJobs: 1, standardJobs: 1, invalidBindingsRejected: 6 })}\n`);
  } finally {
    await client.query("DELETE FROM job_outbox WHERE payload->>'taskId'=$1", [chainTaskId]);
    await client.query("DELETE FROM chain_events WHERE event_args->>'taskId'=$1", [chainTaskId]);
    await client.query("DELETE FROM chain_cursors WHERE name=$1", [cursorName]);
    await client.query("UPDATE paid_capacity_entitlements SET consumed_commitment_id=NULL,consumed_at=NULL WHERE definition_review_id=$1", [reviewId]);
    await client.query("UPDATE task_commitments SET priority_scheduling_attestation_hash=NULL,priority_slots=NULL WHERE id=$1", [commitmentId]);
    await client.query("UPDATE task_definition_reviews SET consumed_at=NULL,commitment_id=NULL WHERE id=$1", [reviewId]);
    await client.query("UPDATE hidden_test_manifests SET status='READY',commitment_id=NULL WHERE id=$1", [hiddenTestId]);
    await client.query("DELETE FROM task_commitments WHERE id=$1", [commitmentId]);
    await client.query("DELETE FROM paid_capacity_entitlements WHERE definition_review_id=$1", [reviewId]);
    await client.query("DELETE FROM task_definition_reviews WHERE id=$1", [reviewId]);
    await client.query("DELETE FROM hidden_test_manifests WHERE id=$1", [hiddenTestId]);
    await client.end();
    await closePostgresForTests();
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
