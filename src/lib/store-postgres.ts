import { Pool, type PoolClient } from "pg";
import type { ProtocolDatabase } from "./types";
import { runtimeConfig } from "./env";
import { randomUUID } from "node:crypto";
import { rewrapArtifactKey } from "./artifact-crypto";
import { taskDefinitionReviewBindingHash, taskDefinitionSchema } from "./task-definition";
import { requiredTesterCapabilityMask } from "./agent-roles";
import { keccak256, stringToHex } from "viem";
import { storedEvidenceHash } from "./signed-evidence";
import { testEvidenceReportSchema } from "./test-evidence-schema";
import type { SignedTaskPromotion } from "./task-promotion";

let pool: Pool | undefined;
let migrated = false;
const transientSecurityRetentionHours = 24;

function databasePool() {
  const connectionString = runtimeConfig().DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  pool ??= new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  return pool;
}

export async function migratePostgres(initialState?: ProtocolDatabase) {
  if (!migrated) {
    const client = await databasePool().connect();
    try {
      await client.query("BEGIN");
      await client.query(`
      CREATE TABLE IF NOT EXISTS protocol_state (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        version BIGINT NOT NULL DEFAULT 1,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS auth_nonces (
        nonce_hash TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        message_hash TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id UUID PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        request_id TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL,
        count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_commitments (
        id UUID PRIMARY KEY,
        publisher TEXT NOT NULL,
        spec_hash TEXT NOT NULL,
        spec JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','EVALUATING','APPROVED','CONFIRMED','REJECTED','ORPHANED')),
        chain_task_id NUMERIC,
        transaction_hash TEXT,
        evaluation_transaction_hash TEXT,
        evaluation_selection_block NUMERIC,
        evaluation_candidate_set_hash TEXT,
        evaluation_candidate_count INTEGER,
        evaluation_approved BOOLEAN,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        confirmed_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS task_definition_reviews (
        id UUID PRIMARY KEY,
        publisher TEXT NOT NULL,
        reviewed_task_hash TEXT NOT NULL CHECK(reviewed_task_hash ~ '^0x[0-9a-f]{64}$'),
        definition_hash TEXT NOT NULL CHECK(definition_hash ~ '^0x[0-9a-f]{64}$'),
        recommendation JSONB NOT NULL,
        reviewers JSONB NOT NULL,
        assessment JSONB NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        commitment_id UUID UNIQUE REFERENCES task_commitments(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chain_cursors (
        name TEXT PRIMARY KEY,
        next_block NUMERIC NOT NULL,
        last_block_hash TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS chain_events (
        chain_id INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number NUMERIC NOT NULL,
        block_hash TEXT NOT NULL,
        block_timestamp TIMESTAMPTZ,
        address TEXT NOT NULL,
        topics JSONB NOT NULL,
        data TEXT NOT NULL,
        event_name TEXT,
        event_args JSONB,
        PRIMARY KEY(chain_id, transaction_hash, log_index)
      );
      ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY,
        recipient TEXT NOT NULL,
        task_id TEXT,
        kind TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        chain_id INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number NUMERIC NOT NULL,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(chain_id,transaction_hash,log_index,recipient),
        FOREIGN KEY(chain_id,transaction_hash,log_index) REFERENCES chain_events(chain_id,transaction_hash,log_index) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS artifact_manifests (
        id UUID PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        sha256 TEXT NOT NULL,
        size_bytes BIGINT NOT NULL CHECK(size_bytes > 0),
        content_type TEXT NOT NULL,
        plaintext_sha256 TEXT,
        encryption_algorithm TEXT,
        content_iv TEXT,
        sealed_key TEXT,
        seal_iv TEXT,
        seal_tag TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','READY')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finalized_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS hidden_test_manifests (
        id UUID PRIMARY KEY,
        publisher TEXT NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        sha256 TEXT NOT NULL,
        plaintext_sha256 TEXT NOT NULL,
        size_bytes BIGINT NOT NULL CHECK(size_bytes > 0),
        content_type TEXT NOT NULL,
        encryption_algorithm TEXT NOT NULL CHECK(encryption_algorithm='AES-256-GCM'),
        content_iv TEXT NOT NULL,
        sealed_key TEXT NOT NULL,
        seal_iv TEXT NOT NULL,
        seal_tag TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','READY','BOUND')),
        commitment_id UUID UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finalized_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS job_outbox (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK(role IN ('EXECUTOR','TESTER','EVALUATOR','COORDINATOR')),
        kind TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        dispatched_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS signed_test_evidence (
        id UUID PRIMARY KEY,
        task_id TEXT NOT NULL,
        tester_agent_id TEXT NOT NULL,
        tester_address TEXT NOT NULL,
        work_round INTEGER NOT NULL CHECK(work_round > 0),
        checkpoint INTEGER NOT NULL CHECK(checkpoint BETWEEN 0 AND 3),
        panel_epoch INTEGER NOT NULL CHECK(panel_epoch > 0),
        verification_shard INTEGER NOT NULL CHECK(verification_shard BETWEEN 0 AND 2),
        artifact_hash TEXT NOT NULL,
        report_hash TEXT NOT NULL,
        report JSONB NOT NULL,
        signature TEXT NOT NULL,
        signing_version TEXT NOT NULL CHECK(signing_version='AgentGrid Test Evidence V4'),
        signing_message TEXT NOT NULL CHECK(signing_message LIKE 'AgentGrid Test Evidence V4%'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(task_id, work_round, checkpoint, panel_epoch, tester_address)
      );
      CREATE TABLE IF NOT EXISTS signed_task_evaluations (
        id UUID PRIMARY KEY,
        task_id TEXT NOT NULL,
        evaluator_agent_id TEXT NOT NULL,
        evaluator_address TEXT NOT NULL,
        approve BOOLEAN NOT NULL,
        report_hash TEXT NOT NULL,
        report JSONB NOT NULL,
        signature TEXT NOT NULL,
        signing_version TEXT NOT NULL CHECK(signing_version='AgentGrid Task Evaluation V2'),
        signing_message TEXT NOT NULL CHECK(signing_message LIKE 'AgentGrid Task Evaluation V2%'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(task_id,evaluator_address)
      );
      CREATE TABLE IF NOT EXISTS artifact_release_audit (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        publisher TEXT NOT NULL,
        chain_state TEXT NOT NULL CHECK(chain_state IN ('MAINTENANCE','COMPLETED')),
        artifact_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS business_adoption_attestations (
        id UUID PRIMARY KEY,
        task_id TEXT NOT NULL,
        publisher TEXT NOT NULL,
        release_id TEXT NOT NULL REFERENCES artifact_release_audit(id) ON DELETE RESTRICT,
        chain_id INTEGER NOT NULL CHECK(chain_id > 0),
        artifact_hash TEXT NOT NULL CHECK(artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
        workflow_type TEXT NOT NULL CHECK(workflow_type IN ('PRODUCTION_DEPLOYED','INTERNAL_WORKFLOW','CUSTOMER_DELIVERED','RESEARCH_DECISION')),
        workflow_evidence_hash TEXT NOT NULL CHECK(workflow_evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
        adopted_at TIMESTAMPTZ NOT NULL,
        report_hash TEXT NOT NULL UNIQUE,
        report JSONB NOT NULL,
        signature TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(task_id,artifact_hash)
      );
      CREATE TABLE IF NOT EXISTS task_promotion_attestations (
        attestation_hash TEXT PRIMARY KEY CHECK(attestation_hash ~ '^0x[0-9a-f]{64}$'),
        payment_receipt_hash TEXT NOT NULL UNIQUE CHECK(payment_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
        task_id TEXT NOT NULL CHECK(task_id ~ '^[1-9][0-9]*$'),
        placement TEXT NOT NULL CHECK(placement IN ('HOMEPAGE','CATEGORY')),
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL CHECK(ends_at > starts_at),
        attestation JSONB NOT NULL,
        signature TEXT NOT NULL CHECK(signature ~ '^0x[0-9a-fA-F]{130}$'),
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(task_id,placement,starts_at,ends_at)
      );
      ALTER TABLE auth_nonces ADD COLUMN IF NOT EXISTS message_hash TEXT;
      ALTER TABLE task_commitments DROP CONSTRAINT IF EXISTS task_commitments_spec_hash_key;
      ALTER TABLE task_commitments ADD COLUMN IF NOT EXISTS evaluation_transaction_hash TEXT;
      ALTER TABLE task_commitments ADD COLUMN IF NOT EXISTS evaluation_selection_block NUMERIC;
      ALTER TABLE task_commitments ADD COLUMN IF NOT EXISTS evaluation_candidate_set_hash TEXT;
      ALTER TABLE task_commitments ADD COLUMN IF NOT EXISTS evaluation_candidate_count INTEGER;
      ALTER TABLE task_commitments ADD COLUMN IF NOT EXISTS evaluation_approved BOOLEAN;
      ALTER TABLE task_commitments DROP CONSTRAINT IF EXISTS task_commitments_status_check;
      ALTER TABLE task_commitments ADD CONSTRAINT task_commitments_status_check CHECK(status IN ('DRAFT','EVALUATING','APPROVED','CONFIRMED','REJECTED','ORPHANED'));
      ALTER TABLE job_outbox DROP CONSTRAINT IF EXISTS job_outbox_role_check;
      ALTER TABLE job_outbox ADD CONSTRAINT job_outbox_role_check CHECK(role IN ('EXECUTOR','TESTER','EVALUATOR','COORDINATOR'));
      ALTER TABLE signed_task_evaluations DROP CONSTRAINT IF EXISTS signed_task_evaluations_task_id_report_hash_key;
      ALTER TABLE signed_test_evidence ADD COLUMN IF NOT EXISTS signing_version TEXT;
      ALTER TABLE signed_test_evidence ADD COLUMN IF NOT EXISTS signing_message TEXT;
      ALTER TABLE signed_test_evidence ADD COLUMN IF NOT EXISTS work_round INTEGER;
      ALTER TABLE signed_test_evidence ADD COLUMN IF NOT EXISTS checkpoint INTEGER;
      ALTER TABLE signed_test_evidence ADD COLUMN IF NOT EXISTS panel_epoch INTEGER;
      ALTER TABLE signed_test_evidence ADD COLUMN IF NOT EXISTS verification_shard INTEGER;
      ALTER TABLE signed_task_evaluations ADD COLUMN IF NOT EXISTS signing_version TEXT;
      ALTER TABLE signed_task_evaluations ADD COLUMN IF NOT EXISTS signing_message TEXT;
      ALTER TABLE signed_test_evidence DROP CONSTRAINT IF EXISTS signed_test_evidence_signing_preimage_check;
      ALTER TABLE signed_test_evidence DROP CONSTRAINT IF EXISTS signed_test_evidence_signing_version_check;
      ALTER TABLE signed_test_evidence DROP CONSTRAINT IF EXISTS signed_test_evidence_signing_message_check;
      ALTER TABLE signed_test_evidence ADD CONSTRAINT signed_test_evidence_signing_preimage_check CHECK(
        (signing_version IS NULL AND signing_message IS NULL) OR
        (signing_version IN ('AgentGrid Test Evidence V2','AgentGrid Test Evidence V3','AgentGrid Test Evidence V4') AND signing_message LIKE signing_version || '%')
      );
      ALTER TABLE signed_test_evidence DROP CONSTRAINT IF EXISTS signed_test_evidence_task_id_report_hash_key;
      ALTER TABLE signed_test_evidence DROP CONSTRAINT IF EXISTS signed_test_evidence_task_id_work_round_tester_address_key;
      ALTER TABLE signed_test_evidence DROP CONSTRAINT IF EXISTS signed_test_evidence_task_id_work_round_checkpoint_panel_epoch_tester_address_key;
      DROP INDEX IF EXISTS signed_test_evidence_panel_member_idx;
      CREATE UNIQUE INDEX signed_test_evidence_panel_member_idx ON signed_test_evidence(task_id,work_round,checkpoint,panel_epoch,LOWER(tester_address)) WHERE work_round IS NOT NULL AND checkpoint IS NOT NULL AND panel_epoch IS NOT NULL;
      ALTER TABLE signed_task_evaluations DROP CONSTRAINT IF EXISTS signed_task_evaluations_signing_preimage_check;
      ALTER TABLE signed_task_evaluations ADD CONSTRAINT signed_task_evaluations_signing_preimage_check CHECK(
        (signing_version IS NULL AND signing_message IS NULL) OR
        (signing_version='AgentGrid Task Evaluation V2' AND signing_message LIKE 'AgentGrid Task Evaluation V2%')
      );
      ALTER TABLE artifact_manifests ADD COLUMN IF NOT EXISTS plaintext_sha256 TEXT;
      ALTER TABLE artifact_manifests ADD COLUMN IF NOT EXISTS encryption_algorithm TEXT;
      ALTER TABLE artifact_manifests ADD COLUMN IF NOT EXISTS content_iv TEXT;
      ALTER TABLE artifact_manifests ADD COLUMN IF NOT EXISTS sealed_key TEXT;
      ALTER TABLE artifact_manifests ADD COLUMN IF NOT EXISTS seal_iv TEXT;
      ALTER TABLE artifact_manifests ADD COLUMN IF NOT EXISTS seal_tag TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS task_commitments_publisher_spec_idx ON task_commitments(publisher,spec_hash);
      CREATE INDEX IF NOT EXISTS task_definition_reviews_publisher_idx ON task_definition_reviews(publisher,created_at DESC);
      CREATE INDEX IF NOT EXISTS task_definition_reviews_expiry_idx ON task_definition_reviews(expires_at) WHERE consumed_at IS NULL;
      CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS auth_nonces_expires_at_idx ON auth_nonces(expires_at);
      CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx ON rate_limits(window_start);
      CREATE INDEX IF NOT EXISTS chain_events_block_idx ON chain_events(chain_id, block_number);
      CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient, read_at, created_at DESC);
      CREATE INDEX IF NOT EXISTS task_commitments_publisher_idx ON task_commitments(publisher, created_at DESC);
      CREATE INDEX IF NOT EXISTS task_commitments_chain_task_idx ON task_commitments(chain_task_id);
      CREATE INDEX IF NOT EXISTS artifact_manifests_task_idx ON artifact_manifests(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS artifact_release_audit_task_idx ON artifact_release_audit(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS business_adoption_publisher_idx ON business_adoption_attestations(publisher, created_at DESC);
      CREATE INDEX IF NOT EXISTS hidden_test_manifests_publisher_idx ON hidden_test_manifests(publisher, created_at DESC);
      CREATE INDEX IF NOT EXISTS job_outbox_pending_idx ON job_outbox(created_at) WHERE dispatched_at IS NULL;
      CREATE INDEX IF NOT EXISTS signed_test_evidence_task_idx ON signed_test_evidence(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS signed_task_evaluations_task_idx ON signed_task_evaluations(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS task_promotions_active_idx ON task_promotion_attestations(starts_at,ends_at) WHERE revoked_at IS NULL;
      `);
      await client.query("COMMIT");
      migrated = true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  if (initialState) {
    await databasePool().query(
      "INSERT INTO protocol_state(singleton, data) VALUES(TRUE, $1::jsonb) ON CONFLICT(singleton) DO NOTHING",
      [JSON.stringify(initialState)],
    );
  }
}

export interface StoredTaskPromotion extends SignedTaskPromotion {
  attestationHash: `0x${string}`;
}

export async function storeVerifiedTaskPromotion(input: StoredTaskPromotion) {
  await migratePostgres();
  const client = await databasePool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${input.attestation.taskId}:${input.attestation.placement}`]);
    const overlap = await client.query(
      `SELECT attestation_hash FROM task_promotion_attestations
       WHERE task_id=$1 AND placement=$2 AND revoked_at IS NULL
         AND tstzrange(starts_at,ends_at,'[)') && tstzrange($3::timestamptz,$4::timestamptz,'[)')`,
      [input.attestation.taskId, input.attestation.placement, input.attestation.startsAt, input.attestation.endsAt],
    );
    if (overlap.rowCount) throw new Error("PROMOTION_WINDOW_OVERLAP");
    await client.query(
      `INSERT INTO task_promotion_attestations(attestation_hash,payment_receipt_hash,task_id,placement,starts_at,ends_at,attestation,signature)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [input.attestationHash.toLowerCase(), input.attestation.paymentReceiptHash, input.attestation.taskId, input.attestation.placement,
        input.attestation.startsAt, input.attestation.endsAt, JSON.stringify(input.attestation), input.signature],
    );
    await client.query("COMMIT");
    return { stored: true as const, attestationHash: input.attestationHash };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function activeTaskPromotionAttestations(now = new Date()) {
  await migratePostgres();
  const result = await databasePool().query<{ attestationHash: `0x${string}`; attestation: SignedTaskPromotion["attestation"]; signature: SignedTaskPromotion["signature"] }>(
    `SELECT attestation_hash AS "attestationHash",attestation,signature
     FROM task_promotion_attestations
     WHERE revoked_at IS NULL AND starts_at<=$1 AND ends_at>$1
     ORDER BY starts_at ASC,attestation_hash ASC`,
    [now],
  );
  return result.rows;
}

export interface TaskCommitmentInput {
  id: string;
  publisher: string;
  specHash: string;
  spec: unknown;
}

export interface TaskDefinitionReviewInput {
  id: string;
  publisher: string;
  reviewedTaskHash: string;
  definitionHash: string;
  recommendation: unknown;
  reviewers: unknown;
  assessment: unknown;
  expiresAt: Date;
}

export async function storeTaskDefinitionReview(input: TaskDefinitionReviewInput) {
  await migratePostgres();
  const result = await databasePool().query(
    `INSERT INTO task_definition_reviews(id,publisher,reviewed_task_hash,definition_hash,recommendation,reviewers,assessment,expires_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)
     RETURNING id,reviewed_task_hash AS "reviewedTaskHash",definition_hash AS "definitionHash",expires_at::text AS "expiresAt"`,
    [input.id, input.publisher.toLowerCase(), input.reviewedTaskHash.toLowerCase(), input.definitionHash.toLowerCase(),
      JSON.stringify(input.recommendation), JSON.stringify(input.reviewers), JSON.stringify(input.assessment), input.expiresAt],
  );
  return result.rows[0];
}

export async function createTaskCommitment(input: TaskCommitmentInput) {
  await migratePostgres();
  const rawSpec = input.spec as {
    definitionReviewId?: unknown; hiddenTestManifestId?: unknown; hiddenTestPlaintextSha256?: unknown;
    title?: unknown; description?: unknown; category?: unknown; executionMode?: unknown; maxExecutors?: unknown; completionDefinition?: unknown;
  };
  const definitionReviewId = String(rawSpec.definitionReviewId ?? "");
  const hiddenTestId = String(rawSpec.hiddenTestManifestId ?? "");
  const hiddenTestHash = String(rawSpec.hiddenTestPlaintextSha256 ?? "").toLowerCase();
  const reviewedTaskHash = taskDefinitionReviewBindingHash({
    title: rawSpec.title,
    businessOutcome: rawSpec.description,
    category: rawSpec.category,
    executionMode: rawSpec.executionMode,
    maxExecutors: rawSpec.maxExecutors,
    completionDefinition: rawSpec.completionDefinition,
  });
  const client = await databasePool().connect();
  try {
    await client.query("BEGIN");
    const review = await client.query<{ reviewedTaskHash: string }>(
      `SELECT reviewed_task_hash AS "reviewedTaskHash" FROM task_definition_reviews
       WHERE id=$1 AND publisher=$2 AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE`,
      [definitionReviewId, input.publisher.toLowerCase()],
    );
    if (!review.rows[0]) throw new Error("TASK_DEFINITION_REVIEW_REQUIRED");
    if (review.rows[0].reviewedTaskHash.toLowerCase() !== reviewedTaskHash.toLowerCase()) throw new Error("TASK_DEFINITION_CHANGED_AFTER_REVIEW");
    const hidden = await client.query<{ plaintextSha256: string }>(
      `SELECT plaintext_sha256 AS "plaintextSha256" FROM hidden_test_manifests
       WHERE id=$1 AND publisher=$2 AND status='READY' FOR UPDATE`,
      [hiddenTestId, input.publisher.toLowerCase()],
    );
    if (!hidden.rows[0]) throw new Error("HIDDEN_TEST_MANIFEST_NOT_READY");
    if (hidden.rows[0].plaintextSha256.toLowerCase() !== hiddenTestHash) throw new Error("HIDDEN_TEST_COMMITMENT_MISMATCH");
    const result = await client.query(
      `INSERT INTO task_commitments(id,publisher,spec_hash,spec) VALUES($1,$2,$3,$4::jsonb)
       RETURNING id,publisher,spec_hash AS "specHash",status,created_at AS "createdAt"`,
      [input.id, input.publisher.toLowerCase(), input.specHash, JSON.stringify(input.spec)],
    );
    await client.query("UPDATE hidden_test_manifests SET status='BOUND',commitment_id=$2 WHERE id=$1", [hiddenTestId, input.id]);
    await client.query("UPDATE task_definition_reviews SET consumed_at=NOW(),commitment_id=$2 WHERE id=$1", [definitionReviewId, input.id]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) { await rollback(client); throw error; } finally { client.release(); }
}

export interface PendingTaskCommitmentRow {
  id: string;
  publisher: string;
  specHash: string;
  spec: Record<string, unknown>;
  status: "DRAFT" | "ORPHANED";
  evaluationTransactionHash: string | null;
  createdAt: string;
}

export async function pendingTaskCommitmentForPublisher(publisher: string) {
  await migratePostgres();
  const result = await databasePool().query<PendingTaskCommitmentRow>(
    `SELECT id,publisher,spec_hash AS "specHash",spec,status,
       evaluation_transaction_hash AS "evaluationTransactionHash",created_at::text AS "createdAt"
     FROM task_commitments
     WHERE publisher=$1 AND status IN ('DRAFT','ORPHANED')
     ORDER BY created_at ASC,id ASC LIMIT 1`,
    [publisher.toLowerCase()],
  );
  return result.rows[0] ?? null;
}

export async function bindTaskCommitmentEvaluationTransaction(id: string, publisher: string, transactionHash: string) {
  await migratePostgres();
  const result = await databasePool().query<PendingTaskCommitmentRow>(
    `UPDATE task_commitments SET evaluation_transaction_hash=$3
     WHERE id=$1 AND publisher=$2 AND status IN ('DRAFT','ORPHANED')
       AND (evaluation_transaction_hash IS NULL OR LOWER(evaluation_transaction_hash)=LOWER($3))
     RETURNING id,publisher,spec_hash AS "specHash",spec,status,
       evaluation_transaction_hash AS "evaluationTransactionHash",created_at::text AS "createdAt"`,
    [id, publisher.toLowerCase(), transactionHash.toLowerCase()],
  );
  if (result.rows[0]) return result.rows[0];
  const existing = await databasePool().query<{ transactionHash: string | null }>(
    `SELECT evaluation_transaction_hash AS "transactionHash" FROM task_commitments
     WHERE id=$1 AND publisher=$2 AND status IN ('DRAFT','ORPHANED')`,
    [id, publisher.toLowerCase()],
  );
  if (!existing.rows[0]) throw new Error("TASK_COMMITMENT_NOT_FOUND");
  throw new Error("TASK_COMMITMENT_TRANSACTION_EQUIVOCATION");
}

export async function clearRevertedTaskCommitmentEvaluationTransaction(id: string, publisher: string, transactionHash: string) {
  await migratePostgres();
  const result = await databasePool().query(
    `UPDATE task_commitments SET evaluation_transaction_hash=NULL
     WHERE id=$1 AND publisher=$2 AND status IN ('DRAFT','ORPHANED')
       AND LOWER(evaluation_transaction_hash)=LOWER($3)
     RETURNING id`,
    [id, publisher.toLowerCase(), transactionHash.toLowerCase()],
  );
  if (!result.rows[0]) throw new Error("TASK_COMMITMENT_TRANSACTION_NOT_FOUND");
  return { id: result.rows[0].id, cleared: true };
}

export interface HiddenTestManifestInput {
  id: string; publisher: string; objectKey: string; sha256: string; plaintextSha256: string; sizeBytes: number;
  contentType: string; encryptionAlgorithm: "AES-256-GCM"; contentIv: string; sealedKey: string; sealIv: string; sealTag: string;
}

export async function createHiddenTestManifest(input: HiddenTestManifestInput) {
  await migratePostgres();
  await databasePool().query(
    `INSERT INTO hidden_test_manifests(id,publisher,object_key,sha256,plaintext_sha256,size_bytes,content_type,encryption_algorithm,content_iv,sealed_key,seal_iv,seal_tag)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [input.id, input.publisher.toLowerCase(), input.objectKey, input.sha256, input.plaintextSha256, input.sizeBytes, input.contentType, input.encryptionAlgorithm, input.contentIv, input.sealedKey, input.sealIv, input.sealTag],
  );
  return input;
}

export async function hiddenTestManifest(id: string, publisher?: string) {
  await migratePostgres();
  const values: string[] = [id];
  const ownerClause = publisher ? " AND publisher=$2" : "";
  if (publisher) values.push(publisher.toLowerCase());
  const result = await databasePool().query<{
    id: string; publisher: string; objectKey: string; sha256: string; plaintextSha256: string; sizeBytes: string; contentType: string;
    encryptionAlgorithm: string; contentIv: string; sealedKey: string; sealIv: string; sealTag: string; status: "PENDING" | "READY" | "BOUND";
  }>(`SELECT id,publisher,object_key AS "objectKey",sha256,plaintext_sha256 AS "plaintextSha256",size_bytes::text AS "sizeBytes",
      content_type AS "contentType",encryption_algorithm AS "encryptionAlgorithm",content_iv AS "contentIv",sealed_key AS "sealedKey",seal_iv AS "sealIv",seal_tag AS "sealTag",status
      FROM hidden_test_manifests WHERE id=$1${ownerClause}`, values);
  if (!result.rows[0]) throw new Error("HIDDEN_TEST_MANIFEST_NOT_FOUND");
  return { ...result.rows[0], sizeBytes: Number(result.rows[0].sizeBytes) };
}

export async function finalizeHiddenTestManifest(id: string, publisher: string) {
  const result = await databasePool().query(
    `UPDATE hidden_test_manifests SET status='READY',finalized_at=NOW() WHERE id=$1 AND publisher=$2 AND status='PENDING'
     RETURNING id,plaintext_sha256 AS "plaintextSha256",size_bytes::text AS "sizeBytes",content_type AS "contentType"`,
    [id, publisher.toLowerCase()],
  );
  if (!result.rows[0]) throw new Error("HIDDEN_TEST_MANIFEST_NOT_FINALIZABLE");
  return { ...result.rows[0], sizeBytes: Number(result.rows[0].sizeBytes) };
}

export async function hiddenTestForTask(taskId: string) {
  await migratePostgres();
  const result = await databasePool().query<{ hiddenTestId: string; publisher: string }>(
    `SELECT c.spec->>'hiddenTestManifestId' AS "hiddenTestId",c.publisher
     FROM task_commitments c WHERE c.chain_task_id=$1 AND c.status='CONFIRMED'`, [taskId],
  );
  if (!result.rows[0]?.hiddenTestId) throw new Error("TASK_HIDDEN_TEST_NOT_FOUND");
  return hiddenTestManifest(result.rows[0].hiddenTestId, result.rows[0].publisher);
}

export interface IndexedChainEvent {
  chainId: number;
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  blockTimestamp?: string;
  address: string;
  topics: readonly string[];
  data: string;
  eventName?: string;
  eventArgs?: Record<string, string | number | boolean | Array<string | number | boolean>>;
}

function chainJobPayload(event: IndexedChainEvent, extra: Record<string, unknown> = {}) {
  return {
    taskId: String(event.eventArgs?.taskId ?? ""),
    ...extra,
    chainId: event.chainId,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    blockNumber: event.blockNumber.toString(),
    ...(event.blockTimestamp ? { blockTimestamp: event.blockTimestamp } : {}),
  };
}

function committedTesterCapabilityMask(spec: Record<string, unknown>) {
  const definition = spec.completionDefinition ? taskDefinitionSchema.parse(spec.completionDefinition) : undefined;
  return definition ? requiredTesterCapabilityMask(definition) : 2;
}

export async function chainCursor(name: string, startBlock: bigint) {
  await migratePostgres();
  const result = await databasePool().query<{ nextBlock: string; lastBlockHash: string | null }>(
    `INSERT INTO chain_cursors(name,next_block) VALUES($1,$2)
     ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name
     RETURNING next_block AS "nextBlock",last_block_hash AS "lastBlockHash"`,
    [name, startBlock.toString()],
  );
  return { nextBlock: BigInt(result.rows[0].nextBlock), lastBlockHash: result.rows[0].lastBlockHash };
}

export async function persistChainBatch(name: string, fromBlock: bigint, nextBlock: bigint, lastBlockHash: string, events: IndexedChainEvent[]) {
  const client = await databasePool().connect();
  try {
    await client.query("BEGIN");
    const cursor = await client.query<{ nextBlock: string }>("SELECT next_block AS \"nextBlock\" FROM chain_cursors WHERE name=$1 FOR UPDATE", [name]);
    if (BigInt(cursor.rows[0]?.nextBlock ?? -1) !== fromBlock) throw new Error("CHAIN_CURSOR_MOVED");
    for (const event of events) {
      await client.query(
        `INSERT INTO chain_events(chain_id,transaction_hash,log_index,block_number,block_hash,block_timestamp,address,topics,data,event_name,event_args)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb) ON CONFLICT DO NOTHING`,
        [event.chainId, event.transactionHash, event.logIndex, event.blockNumber.toString(), event.blockHash, event.blockTimestamp ?? null, event.address.toLowerCase(), JSON.stringify(event.topics), event.data, event.eventName ?? null, JSON.stringify(event.eventArgs ?? null)],
      );
      if (event.eventName === "TaskEvaluationRequested" && event.eventArgs?.specHash && event.eventArgs?.publisher) {
        const evaluating = await client.query(
          `UPDATE task_commitments SET status='EVALUATING',chain_task_id=$1,evaluation_transaction_hash=$2,
             evaluation_selection_block=$3,evaluation_candidate_set_hash=$4,evaluation_candidate_count=$5,evaluation_approved=NULL
           WHERE spec_hash=$6 AND publisher=$7 AND status IN ('DRAFT','ORPHANED') RETURNING id`,
          [String(event.eventArgs.taskId), event.transactionHash, String(event.eventArgs.selectionBlock), String(event.eventArgs.candidateSetHash), Number(event.eventArgs.candidateCount), String(event.eventArgs.specHash), String(event.eventArgs.publisher).toLowerCase()],
        );
        if (evaluating.rowCount !== 1) throw new Error("EVALUATION_COMMITMENT_NOT_FOUND_OR_AMBIGUOUS");
      }
      if (event.eventName === "TaskEvaluationFinalized") {
        const approved = event.eventArgs?.approved === true;
        await client.query(
          `UPDATE task_commitments SET status=$2,evaluation_approved=$3
           WHERE chain_task_id=$1 AND status='EVALUATING'`,
          [String(event.eventArgs?.taskId), approved ? "APPROVED" : "REJECTED", approved],
        );
      }
      if (event.eventName === "SelectionPoolSealed" && event.eventArgs?.evaluatorPanel === true) {
        await client.query(
          `UPDATE task_commitments SET evaluation_selection_block=$2
           WHERE chain_task_id=$1 AND status='EVALUATING'`,
          [String(event.eventArgs.taskId), String(event.eventArgs.selectionBlock)],
        );
      }
      if (event.eventName === "TaskCreated" && event.eventArgs?.specHash) {
        const candidate = await client.query<{ id: string; spec: Record<string, unknown> }>(
          `SELECT id,spec FROM task_commitments WHERE spec_hash=$1 AND publisher=$2 AND status IN ('APPROVED','ORPHANED') FOR UPDATE`,
          [String(event.eventArgs.specHash), String(event.eventArgs.publisher).toLowerCase()],
        );
        if (candidate.rowCount !== 1) throw new Error("APPROVED_TASK_COMMITMENT_NOT_FOUND_OR_AMBIGUOUS");
        const expectedTesterCapabilities = committedTesterCapabilityMask(candidate.rows[0].spec);
        const recordedCapabilities = await client.query<{ requiredCapabilities: string }>(
          `SELECT event_args->>'requiredCapabilities' AS "requiredCapabilities" FROM chain_events
           WHERE event_name='TaskTesterCapabilitiesSet' AND event_args->>'taskId'=$1
           ORDER BY block_number DESC,log_index DESC LIMIT 1`,
          [String(event.eventArgs.taskId)],
        );
        if (Number(recordedCapabilities.rows[0]?.requiredCapabilities ?? 2) !== expectedTesterCapabilities) {
          await client.query(`UPDATE task_commitments SET status='REJECTED',evaluation_approved=FALSE WHERE id=$1`, [candidate.rows[0].id]);
          await client.query("DELETE FROM job_outbox WHERE payload->>'taskId'=$1", [String(event.eventArgs.taskId)]);
          continue;
        }
        const confirmed = await client.query<{ executorSlots: number }>(
          `UPDATE task_commitments SET status='CONFIRMED',chain_task_id=$1,transaction_hash=$2,confirmed_at=NOW()
           WHERE id=$3
           RETURNING LEAST(32,GREATEST(1,(spec->>'maxExecutors')::int)) AS "executorSlots"`,
          [String(event.eventArgs.taskId), event.transactionHash, candidate.rows[0].id],
        );
        const executorSlots = confirmed.rows[0].executorSlots;
        for (let slot = 1; slot <= executorSlots; slot += 1) {
          const id = `${event.chainId}:${event.transactionHash}:${event.logIndex}:EXECUTE_TASK:${slot}`;
          await client.query(
            `INSERT INTO job_outbox(id,role,kind,payload) VALUES($1,'EXECUTOR','EXECUTE_TASK',$2::jsonb) ON CONFLICT(id) DO NOTHING`,
            [id, JSON.stringify(chainJobPayload(event, { slot, executorSlots }))],
          );
        }
      }
      if ((event.eventName === "TestSubmitted" || event.eventName === "CompetitionResultSubmitted") && event.eventArgs?.passed === false) {
        const taskId = String(event.eventArgs.taskId);
        const executors = await client.query<{ executor: string }>(
          `SELECT executor FROM (
             SELECT DISTINCT ON (LOWER(event_args->>'executor')) event_args->>'executor' executor,event_name
             FROM chain_events WHERE event_name IN ('TaskClaimed','ExecutorEvicted') AND event_args->>'taskId'=$1
             ORDER BY LOWER(event_args->>'executor'),block_number DESC,log_index DESC
           ) latest WHERE event_name='TaskClaimed'`, [taskId],
        );
        for (const { executor } of executors.rows) {
          const id = `${event.chainId}:${event.transactionHash}:${event.logIndex}:REVISE_TASK:${executor.toLowerCase()}`;
          await client.query(
            `INSERT INTO job_outbox(id,role,kind,payload) VALUES($1,'EXECUTOR','REVISE_TASK',$2::jsonb) ON CONFLICT(id) DO NOTHING`,
            [id, JSON.stringify(chainJobPayload(event, { executor }))],
          );
        }
      }
      if (event.eventName === "MaintenanceRepairRequested") {
        const taskId = String(event.eventArgs?.taskId);
        const executors = await client.query<{ executor: string }>(
          `SELECT executor FROM (
             SELECT DISTINCT ON (LOWER(event_args->>'executor')) event_args->>'executor' executor,event_name
             FROM chain_events WHERE event_name IN ('TaskClaimed','ExecutorEvicted') AND event_args->>'taskId'=$1
             ORDER BY LOWER(event_args->>'executor'),block_number DESC,log_index DESC
           ) latest WHERE event_name='TaskClaimed'`, [taskId],
        );
        for (const { executor } of executors.rows) {
          const id = `${event.chainId}:${event.transactionHash}:${event.logIndex}:REPAIR_MAINTENANCE:${executor.toLowerCase()}`;
          await client.query(
            `INSERT INTO job_outbox(id,role,kind,payload) VALUES($1,'EXECUTOR','REPAIR_MAINTENANCE',$2::jsonb) ON CONFLICT(id) DO NOTHING`,
            [id, JSON.stringify(chainJobPayload(event, {
              executor,
              checkpoint: Number(event.eventArgs?.checkpoint),
              evidenceHash: String(event.eventArgs?.evidenceHash ?? ""),
            }))],
          );
        }
      }
      if (event.eventName === "TaskEvaluatorsAssigned") {
        for (const evaluator of [event.eventArgs?.evaluator0, event.eventArgs?.evaluator1, event.eventArgs?.evaluator2]) {
          if (typeof evaluator !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(evaluator)) throw new Error("INVALID_EVALUATOR_ASSIGNMENT_EVENT");
          const id = `${event.chainId}:${event.transactionHash}:${event.logIndex}:EVALUATE_TASK:${evaluator.toLowerCase()}`;
          await client.query(
            `INSERT INTO job_outbox(id,role,kind,payload) VALUES($1,'EVALUATOR','EVALUATE_TASK',$2::jsonb) ON CONFLICT(id) DO NOTHING`,
            [id, JSON.stringify(chainJobPayload(event, { tester: evaluator }))],
          );
        }
      }
      if (event.eventName === "TaskEvaluationSubmitted") {
        const reports = await client.query<{ reportCount: string; rejectCount: string }>(
          `SELECT COUNT(DISTINCT LOWER(event_args->>'evaluator'))::text AS "reportCount",
                  COUNT(DISTINCT LOWER(event_args->>'evaluator')) FILTER (WHERE (event_args->>'approve')::boolean=FALSE)::text AS "rejectCount"
           FROM chain_events WHERE event_name='TaskEvaluationSubmitted' AND event_args->>'taskId'=$1`,
          [String(event.eventArgs?.taskId)],
        );
        if (Number(reports.rows[0]?.reportCount) >= 3 || Number(reports.rows[0]?.rejectCount) >= 2) {
          const id = `${event.chainId}:${event.transactionHash}:${event.logIndex}:FINALIZE_TASK_EVALUATION`;
          await client.query(
            `INSERT INTO job_outbox(id,role,kind,payload) VALUES($1,'COORDINATOR','FINALIZE_TASK_EVALUATION',$2::jsonb) ON CONFLICT(id) DO NOTHING`,
            [id, JSON.stringify(chainJobPayload(event))],
          );
        }
      }
      if (event.eventName === "TesterPanelAssigned") {
        for (const key of ["tester0", "tester1", "tester2"] as const) {
          const tester = event.eventArgs?.[key];
          const shard = Number(key.slice(-1));
          const id = `${event.chainId}:${event.transactionHash}:${event.logIndex}:TEST_TASK:${shard}`;
          await client.query(
            `INSERT INTO job_outbox(id,role,kind,payload) VALUES($1,'TESTER','TEST_TASK',$2::jsonb) ON CONFLICT(id) DO NOTHING`,
            [id, JSON.stringify(chainJobPayload(event, { tester, shard }))],
          );
        }
      }
      if (event.eventName === "PanelRevealReady") {
        const taskId = String(event.eventArgs?.taskId);
        const workRound = Number(event.eventArgs?.workRound);
        const checkpoint = Number(event.eventArgs?.checkpoint);
        const panelEpoch = Number(event.eventArgs?.epoch);
        const testers = event.eventArgs?.testers;
        if (!Array.isArray(testers) || testers.length !== 3) throw new Error("INVALID_PANEL_REVEAL_READY_EVENT");
        for (let shard = 0; shard < testers.length; shard += 1) {
          const tester = String(testers[shard]);
          const evidence = await client.query<{
            testerAddress: string; artifactHash: string; reportHash: string; report: unknown; signature: string;
          }>(
            `SELECT tester_address AS "testerAddress",artifact_hash AS "artifactHash",report_hash AS "reportHash",report,signature
             FROM signed_test_evidence
             WHERE task_id=$1 AND work_round=$2 AND checkpoint=$3 AND panel_epoch=$4 AND verification_shard=$5 AND LOWER(tester_address)=LOWER($6)
             LIMIT 1`,
            [taskId, workRound, checkpoint, panelEpoch, shard, tester],
          );
          const row = evidence.rows[0];
          const parsed = testEvidenceReportSchema.safeParse(row?.report);
          if (!row || !parsed.success) continue;
          const report = parsed.data;
          const criterionPassMask = (report.criterionResults ?? []).reduce((mask, result) => {
            const criterionIndex = Number(result.criterionId.split("-")[1]) - 1;
            return result.passed && criterionIndex >= 0 && criterionIndex < 16 ? mask | (1 << criterionIndex) : mask;
          }, 0);
          const winner = report.competition?.winner ?? `0x${"0".repeat(40)}`;
          const selectedArtifactHash = report.competition?.selectedArtifactHash
            ? keccak256(stringToHex(report.competition.selectedArtifactHash))
            : `0x${"0".repeat(64)}`;
          const id = `${event.chainId}:${event.transactionHash}:${event.logIndex}:REVEAL_TEST_SHARD:${shard}`;
          await client.query(
            `INSERT INTO job_outbox(id,role,kind,payload) VALUES($1,'TESTER','REVEAL_TEST_SHARD',$2::jsonb) ON CONFLICT(id) DO NOTHING`,
            [id, JSON.stringify(chainJobPayload(event, {
              tester, shard, workRound, checkpoint, panelEpoch, reportHash: row.reportHash,
              evidenceHash: storedEvidenceHash(row), criterionPassMask, winner, selectedArtifactHash,
              executorWeightsBps: report.passed ? report.executorWeightsBps : [], salt: keccak256(row.signature as `0x${string}`), passed: report.passed,
            }))],
          );
        }
      }
      const queued = event.eventName === "TeamReady"
          ? { role: "EXECUTOR", kind: "ASSEMBLE_TASK" }
        : event.eventName === "CompetitionReady"
          ? { role: "COORDINATOR", kind: "ASSIGN_TESTER" }
        : event.eventName === "ExecutorEvicted"
          ? { role: "EXECUTOR", kind: "EXECUTE_TASK" }
        : event.eventName === "WorkSubmitted"
          ? { role: "COORDINATOR", kind: "ASSIGN_TESTER" }
          : event.eventName === "SelectionPoolStarted"
            ? { role: "COORDINATOR", kind: "BUILD_SELECTION_POOL" }
          : event.eventName === "SelectionPoolSealed"
            ? { role: "COORDINATOR", kind: event.eventArgs?.evaluatorPanel === true ? "FINALIZE_EVALUATION_PANEL" : "FINALIZE_TESTER" }
            : null;
      if (queued) {
        const id = `${event.chainId}:${event.transactionHash}:${event.logIndex}:${queued.kind}`;
        await client.query(
          `INSERT INTO job_outbox(id,role,kind,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING`,
          [id, queued.role, queued.kind, JSON.stringify(chainJobPayload(event, {
            ...(event.eventName === "TeamReady" ? { executor: event.eventArgs?.leadExecutor } : {}),
            ...(event.eventName === "ExecutorEvicted" ? { executor: undefined } : {}),
            ...(event.eventName === "SelectionPoolStarted" ? {
              poolId: String(event.eventArgs?.poolId ?? ""),
              candidateCount: String(event.eventArgs?.candidateCount ?? ""),
            } : {}),
            ...(event.eventName === "SelectionPoolSealed" ? {
              poolId: String(event.eventArgs?.poolId ?? ""),
              selectionBlock: String(event.eventArgs?.selectionBlock ?? ""),
            } : {}),
          }))],
        );
      }
      await persistEventNotifications(client, event);
    }
    await client.query("UPDATE chain_cursors SET next_block=$2,last_block_hash=$3,updated_at=NOW() WHERE name=$1", [name, nextBlock.toString(), lastBlockHash]);
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  } finally { client.release(); }
}

const notificationEvents = new Set([
  "TaskEvaluationRequested", "TaskEvaluationFeeCharged", "TaskEvaluatorsAssigned", "TaskEvaluationSubmitted", "TaskEvaluationFinalized", "TaskEvaluationExpired", "EvaluationFeePaid", "EvaluationFeeSettled",
  "TaskCreated", "TaskExecutionModeSet", "TaskTesterCapabilitiesSet", "TaskPublicationFeeCharged", "TaskClaimed", "ExecutorEvicted", "TeamClosed", "ContributionSubmitted", "TeamReady", "CompetitionReady", "WorkSubmitted", "TesterAssigned", "TesterPanelAssigned", "TestSubmitted", "CompetitionResultSubmitted", "UserReviewed",
  "RejectionResponded", "RejectionResolved", "MaintenanceValidated", "MaintenanceRepairRequested", "GrantCreated", "FutureParticipantsUpdated", "RewardClaimed",
]);

async function persistEventNotifications(client: PoolClient, event: IndexedChainEvent) {
  if (!event.eventName || !notificationEvents.has(event.eventName) || !event.eventArgs) return;
  const taskId = event.eventArgs.taskId === undefined ? null : String(event.eventArgs.taskId);
  const recipients = new Set<string>();
  for (const key of ["publisher", "executor", "tester", "tester0", "tester1", "tester2", "evaluator", "evaluator0", "evaluator1", "evaluator2"] as const) {
    const value = event.eventArgs[key];
    if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) recipients.add(value.toLowerCase());
  }
  if (taskId) {
    const participants = await client.query<{ publisher: string | null; tester: string | null }>(
      `SELECT c.publisher,
        (SELECT event_args->>'tester' FROM chain_events WHERE event_name='TesterAssigned' AND event_args->>'taskId'=$1 ORDER BY block_number DESC,log_index DESC LIMIT 1) tester
       FROM task_commitments c WHERE c.chain_task_id::text=$1 LIMIT 1`, [taskId],
    );
    for (const value of Object.values(participants.rows[0] ?? {})) if (value) recipients.add(value.toLowerCase());
    const executors = await client.query<{ executor: string }>(
      `SELECT DISTINCT event_args->>'executor' executor FROM chain_events WHERE event_name='TaskClaimed' AND event_args->>'taskId'=$1`, [taskId],
    );
    for (const { executor } of executors.rows) if (executor) recipients.add(executor.toLowerCase());
  }
  for (const recipient of recipients) {
    await client.query(
      `INSERT INTO notifications(id,recipient,task_id,kind,payload,chain_id,transaction_hash,log_index,block_number)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) ON CONFLICT(chain_id,transaction_hash,log_index,recipient) DO NOTHING`,
      [randomUUID(), recipient, taskId, event.eventName, JSON.stringify(event.eventArgs), event.chainId, event.transactionHash, event.logIndex, event.blockNumber.toString()],
    );
  }
}

export interface NotificationRow { id: string; taskId: string | null; kind: string; payload: Record<string, unknown>; readAt: string | null; createdAt: string }

export async function notificationsForRecipient(recipient: string, limit = 100) {
  await migratePostgres();
  const result = await databasePool().query<NotificationRow>(
    `SELECT id,task_id AS "taskId",kind,payload,read_at::text AS "readAt",created_at::text AS "createdAt"
     FROM notifications WHERE recipient=$1 ORDER BY created_at DESC LIMIT $2`, [recipient.toLowerCase(), limit],
  );
  return result.rows;
}

export async function markNotificationRead(id: string, recipient: string) {
  await migratePostgres();
  const result = await databasePool().query(
    `UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND recipient=$2 RETURNING id,read_at AS "readAt"`,
    [id, recipient.toLowerCase()],
  );
  if (!result.rows[0]) throw new Error("NOTIFICATION_NOT_FOUND");
  return result.rows[0];
}

export async function rewindChain(name: string, rewindTo: bigint) {
  const client = await databasePool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM job_outbox WHERE payload ? 'blockNumber' AND (payload->>'blockNumber')::numeric >= $1", [rewindTo.toString()]);
    await client.query("DELETE FROM notifications WHERE block_number >= $1", [rewindTo.toString()]);
    await client.query("DELETE FROM chain_events WHERE block_number >= $1", [rewindTo.toString()]);
    await client.query(
      `UPDATE task_commitments SET status='ORPHANED',chain_task_id=NULL,transaction_hash=NULL,confirmed_at=NULL,
         evaluation_transaction_hash=NULL,evaluation_selection_block=NULL,evaluation_candidate_set_hash=NULL,
         evaluation_candidate_count=NULL,evaluation_approved=NULL
       WHERE chain_task_id IS NOT NULL OR status IN ('EVALUATING','APPROVED','CONFIRMED','REJECTED','ORPHANED')`,
    );
    await client.query(
      `UPDATE task_commitments c SET status='EVALUATING',chain_task_id=(r.event_args->>'taskId')::numeric,
         evaluation_transaction_hash=r.transaction_hash,evaluation_selection_block=(r.event_args->>'selectionBlock')::numeric,
         evaluation_candidate_set_hash=r.event_args->>'candidateSetHash',evaluation_candidate_count=(r.event_args->>'candidateCount')::int
       FROM chain_events r WHERE r.event_name='TaskEvaluationRequested' AND LOWER(r.event_args->>'publisher')=c.publisher
         AND LOWER(r.event_args->>'specHash')=LOWER(c.spec_hash)`,
    );
    await client.query(
      `UPDATE task_commitments c SET status=CASE WHEN (f.event_args->>'approved')::boolean THEN 'APPROVED' ELSE 'REJECTED' END,
         evaluation_approved=(f.event_args->>'approved')::boolean
       FROM chain_events f WHERE f.event_name='TaskEvaluationFinalized' AND f.event_args->>'taskId'=c.chain_task_id::text`,
    );
    await client.query(
      `UPDATE task_commitments c SET status='CONFIRMED',transaction_hash=created.transaction_hash,confirmed_at=COALESCE(c.confirmed_at,NOW())
       FROM chain_events created WHERE created.event_name='TaskCreated' AND LOWER(created.event_args->>'publisher')=c.publisher
         AND LOWER(created.event_args->>'specHash')=LOWER(c.spec_hash)`,
    );
    const confirmed = await client.query<{ id: string; spec: Record<string, unknown>; chainTaskId: string; requiredCapabilities: string | null }>(
      `SELECT c.id,c.spec,c.chain_task_id::text AS "chainTaskId",cap.event_args->>'requiredCapabilities' AS "requiredCapabilities"
       FROM task_commitments c
       LEFT JOIN LATERAL (
         SELECT event_args FROM chain_events WHERE event_name='TaskTesterCapabilitiesSet' AND event_args->>'taskId'=c.chain_task_id::text
         ORDER BY block_number DESC,log_index DESC LIMIT 1
       ) cap ON TRUE
       WHERE c.status='CONFIRMED' FOR UPDATE OF c`,
    );
    for (const row of confirmed.rows) {
      if (Number(row.requiredCapabilities ?? 2) === committedTesterCapabilityMask(row.spec)) continue;
      await client.query("UPDATE task_commitments SET status='REJECTED',evaluation_approved=FALSE WHERE id=$1", [row.id]);
      await client.query("DELETE FROM job_outbox WHERE payload->>'taskId'=$1", [row.chainTaskId]);
    }
    await client.query("UPDATE chain_cursors SET next_block=$2,last_block_hash=NULL,updated_at=NOW() WHERE name=$1", [name, rewindTo.toString()]);
    await client.query("COMMIT");
  } catch (error) { await rollback(client); throw error; } finally { client.release(); }
}

export async function canonicalChainJobEvent(
  transactionHash: string,
  blockNumber: string,
  chainId?: number,
  logIndex?: number,
) {
  await migratePostgres();
  const result = await databasePool().query<{ canonical: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM chain_events
       WHERE LOWER(transaction_hash)=LOWER($1) AND block_number=$2::numeric
         AND ($3::integer IS NULL OR chain_id=$3)
         AND ($4::integer IS NULL OR log_index=$4)
     ) AS canonical`,
    [transactionHash, blockNumber, chainId ?? null, logIndex ?? null],
  );
  return result.rows[0]?.canonical === true;
}

export interface ChainProjectionRow {
  eventName: string | null;
  eventArgs: Record<string, string | number | boolean | Array<string | number | boolean>> | null;
  transactionHash: string;
  blockNumber: string;
  blockTimestamp?: string | null;
}

export interface CommitmentProjectionRow {
  specHash: string;
  spec: unknown;
  status: "DRAFT" | "EVALUATING" | "APPROVED" | "CONFIRMED" | "REJECTED" | "ORPHANED";
  chainTaskId: string | null;
  publisher: string;
  createdAt: string;
  confirmedAt: string | null;
}

export async function readChainProjectionRows() {
  await migratePostgres();
  const [events, commitments] = await Promise.all([
    databasePool().query<ChainProjectionRow>(
      `SELECT event_name AS "eventName",event_args AS "eventArgs",transaction_hash AS "transactionHash",block_number::text AS "blockNumber",block_timestamp::text AS "blockTimestamp"
       FROM chain_events WHERE event_name IS NOT NULL ORDER BY block_number,log_index`,
    ),
    databasePool().query<CommitmentProjectionRow>(
      `SELECT spec_hash AS "specHash",spec,status,chain_task_id::text AS "chainTaskId",publisher,
              created_at::text AS "createdAt",confirmed_at::text AS "confirmedAt"
       FROM task_commitments ORDER BY created_at`,
    ),
  ]);
  return { events: events.rows, commitments: commitments.rows };
}

export interface ArtifactManifestInput {
  id: string;
  taskId: string;
  agentId: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  plaintextSha256: string;
  encryptionAlgorithm: "AES-256-GCM";
  contentIv: string;
  sealedKey: string;
  sealIv: string;
  sealTag: string;
}

export async function createArtifactManifest(input: ArtifactManifestInput) {
  await migratePostgres();
  await databasePool().query(
    `INSERT INTO artifact_manifests(id,task_id,agent_id,object_key,sha256,size_bytes,content_type,plaintext_sha256,encryption_algorithm,content_iv,sealed_key,seal_iv,seal_tag)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [input.id, input.taskId, input.agentId, input.objectKey, input.sha256, input.sizeBytes, input.contentType, input.plaintextSha256, input.encryptionAlgorithm, input.contentIv, input.sealedKey, input.sealIv, input.sealTag],
  );
  return input;
}

export async function artifactManifest(id: string, agentId: string) {
  await migratePostgres();
  const result = await databasePool().query<{
    id: string; taskId: string; agentId: string; objectKey: string; sha256: string; sizeBytes: string; contentType: string; status: "PENDING" | "READY"; plaintextSha256: string; encryptionAlgorithm: string; contentIv: string; sealedKey: string; sealIv: string; sealTag: string;
  }>(
    `SELECT id,task_id AS "taskId",agent_id AS "agentId",object_key AS "objectKey",sha256,size_bytes::text AS "sizeBytes",content_type AS "contentType",status,
            plaintext_sha256 AS "plaintextSha256",encryption_algorithm AS "encryptionAlgorithm",content_iv AS "contentIv",sealed_key AS "sealedKey",seal_iv AS "sealIv",seal_tag AS "sealTag"
     FROM artifact_manifests WHERE id=$1 AND agent_id=$2`,
    [id, agentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("ARTIFACT_NOT_FOUND");
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}

export async function finalizeArtifactManifest(id: string, agentId: string, objectKey: string) {
  const result = await databasePool().query(
    `UPDATE artifact_manifests SET status='READY',object_key=$3,finalized_at=NOW()
     WHERE id=$1 AND agent_id=$2 AND status='PENDING'
     RETURNING id,task_id AS "taskId",object_key AS "objectKey",sha256,size_bytes AS "sizeBytes",content_type AS "contentType",status`,
    [id, agentId, objectKey],
  );
  if (!result.rows[0]) throw new Error("ARTIFACT_NOT_FINALIZABLE");
  return result.rows[0];
}

export async function latestReadyArtifactForTask(taskId: string) {
  await migratePostgres();
  const result = await databasePool().query<{
    id: string; taskId: string; agentId: string; objectKey: string; sha256: string; sizeBytes: string; contentType: string; plaintextSha256: string; encryptionAlgorithm: string; contentIv: string; sealedKey: string; sealIv: string; sealTag: string;
  }>(
    `SELECT id,task_id AS "taskId",agent_id AS "agentId",object_key AS "objectKey",sha256,size_bytes::text AS "sizeBytes",content_type AS "contentType",
            plaintext_sha256 AS "plaintextSha256",encryption_algorithm AS "encryptionAlgorithm",content_iv AS "contentIv",sealed_key AS "sealedKey",seal_iv AS "sealIv",seal_tag AS "sealTag"
     FROM artifact_manifests WHERE task_id=$1 AND status='READY' ORDER BY finalized_at DESC LIMIT 1`,
    [taskId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("ARTIFACT_NOT_FOUND");
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}

export async function readyArtifactsForTask(taskId: string) {
  await migratePostgres();
  const result = await databasePool().query<{
    id: string; taskId: string; agentId: string; objectKey: string; sha256: string; sizeBytes: string; contentType: string; plaintextSha256: string; encryptionAlgorithm: string; contentIv: string; sealedKey: string; sealIv: string; sealTag: string;
  }>(
    `SELECT id,task_id AS "taskId",agent_id AS "agentId",object_key AS "objectKey",sha256,size_bytes::text AS "sizeBytes",content_type AS "contentType",
            plaintext_sha256 AS "plaintextSha256",encryption_algorithm AS "encryptionAlgorithm",content_iv AS "contentIv",sealed_key AS "sealedKey",seal_iv AS "sealIv",seal_tag AS "sealTag"
     FROM artifact_manifests WHERE task_id=$1 AND status='READY' ORDER BY finalized_at DESC`,
    [taskId],
  );
  return result.rows.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes) }));
}

export async function recordArtifactRelease(input: {
  id: string;
  taskId: string;
  artifactId: string;
  publisher: string;
  chainState: "MAINTENANCE" | "COMPLETED";
  artifactHash: string;
  expiresAt: Date;
}) {
  await migratePostgres();
  await databasePool().query(
    `INSERT INTO artifact_release_audit(id,task_id,artifact_id,publisher,chain_state,artifact_hash,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [input.id, input.taskId, input.artifactId, input.publisher.toLowerCase(), input.chainState, input.artifactHash, input.expiresAt],
  );
  return input;
}

export async function latestPublisherArtifactRelease(taskId: string, publisher: string) {
  await migratePostgres();
  const result = await databasePool().query<{
    id: string; taskId: string; artifactId: string; publisher: string; chainState: "MAINTENANCE" | "COMPLETED"; artifactHash: string; expiresAt: string; createdAt: string;
  }>(
    `SELECT id,task_id AS "taskId",artifact_id AS "artifactId",publisher,chain_state AS "chainState",
            artifact_hash AS "artifactHash",expires_at AS "expiresAt",created_at AS "createdAt"
     FROM artifact_release_audit WHERE task_id=$1 AND LOWER(publisher)=LOWER($2)
     ORDER BY created_at DESC LIMIT 1`,
    [taskId, publisher],
  );
  return result.rows[0];
}

export async function publisherArtifactReleaseById(releaseId: string, taskId: string, publisher: string) {
  await migratePostgres();
  const result = await databasePool().query<{
    id: string; taskId: string; artifactId: string; publisher: string; chainState: "MAINTENANCE" | "COMPLETED"; artifactHash: string; expiresAt: string; createdAt: string;
  }>(
    `SELECT id,task_id AS "taskId",artifact_id AS "artifactId",publisher,chain_state AS "chainState",
            artifact_hash AS "artifactHash",expires_at AS "expiresAt",created_at AS "createdAt"
     FROM artifact_release_audit WHERE id=$1 AND task_id=$2 AND LOWER(publisher)=LOWER($3)`,
    [releaseId, taskId, publisher],
  );
  return result.rows[0];
}

export interface StoredBusinessAdoption {
  id: string;
  taskId: string;
  publisher: string;
  releaseId: string;
  chainId: number;
  artifactHash: string;
  workflowType: "PRODUCTION_DEPLOYED" | "INTERNAL_WORKFLOW" | "CUSTOMER_DELIVERED" | "RESEARCH_DECISION";
  workflowEvidenceHash: string;
  adoptedAt: string;
  reportHash: string;
  report: unknown;
  signature: string;
  createdAt: string;
}

export async function storeBusinessAdoption(input: Omit<StoredBusinessAdoption, "createdAt">) {
  await migratePostgres();
  try {
    await databasePool().query(
      `INSERT INTO business_adoption_attestations(
         id,task_id,publisher,release_id,chain_id,artifact_hash,workflow_type,workflow_evidence_hash,adopted_at,report_hash,report,signature
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
      [input.id, input.taskId, input.publisher.toLowerCase(), input.releaseId, input.chainId, input.artifactHash, input.workflowType,
        input.workflowEvidenceHash, input.adoptedAt, input.reportHash, JSON.stringify(input.report), input.signature],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("BUSINESS_ADOPTION_ALREADY_RECORDED");
    throw error;
  }
  return input;
}

export async function businessAdoptionForTask(taskId: string, artifactHash: string) {
  await migratePostgres();
  const result = await databasePool().query<StoredBusinessAdoption>(
    `SELECT id,task_id AS "taskId",publisher,release_id AS "releaseId",chain_id AS "chainId",artifact_hash AS "artifactHash",
            workflow_type AS "workflowType",workflow_evidence_hash AS "workflowEvidenceHash",adopted_at AS "adoptedAt",
            report_hash AS "reportHash",report,signature,created_at AS "createdAt"
     FROM business_adoption_attestations WHERE task_id=$1 AND artifact_hash=$2`,
    [taskId, artifactHash],
  );
  return result.rows[0];
}

export async function latestBusinessAdoptions() {
  await migratePostgres();
  const result = await databasePool().query<StoredBusinessAdoption>(
    `SELECT id,task_id AS "taskId",publisher,release_id AS "releaseId",chain_id AS "chainId",artifact_hash AS "artifactHash",
            workflow_type AS "workflowType",workflow_evidence_hash AS "workflowEvidenceHash",adopted_at AS "adoptedAt",
            report_hash AS "reportHash",report,signature,created_at AS "createdAt"
     FROM business_adoption_attestations ORDER BY created_at DESC`,
  );
  return result.rows;
}

export async function rotateArtifactMasterKeyEnvelopes() {
  await migratePostgres();
  const client = await databasePool().connect();
  try {
    await client.query("BEGIN");
    const artifacts = await client.query<{ id: string; sealedKey: string; sealIv: string; sealTag: string }>(
      `SELECT id,sealed_key AS "sealedKey",seal_iv AS "sealIv",seal_tag AS "sealTag"
       FROM artifact_manifests WHERE sealed_key IS NOT NULL AND seal_iv IS NOT NULL AND seal_tag IS NOT NULL FOR UPDATE`,
    );
    const hiddenTests = await client.query<{ id: string; sealedKey: string; sealIv: string; sealTag: string }>(
      `SELECT id,sealed_key AS "sealedKey",seal_iv AS "sealIv",seal_tag AS "sealTag" FROM hidden_test_manifests FOR UPDATE`,
    );
    for (const row of artifacts.rows) {
      const rotated = rewrapArtifactKey(row);
      await client.query("UPDATE artifact_manifests SET sealed_key=$2,seal_iv=$3,seal_tag=$4 WHERE id=$1", [row.id, rotated.sealedKey, rotated.sealIv, rotated.sealTag]);
    }
    for (const row of hiddenTests.rows) {
      const rotated = rewrapArtifactKey(row);
      await client.query("UPDATE hidden_test_manifests SET sealed_key=$2,seal_iv=$3,seal_tag=$4 WHERE id=$1", [row.id, rotated.sealedKey, rotated.sealIv, rotated.sealTag]);
    }
    await client.query("COMMIT");
    return { artifactEnvelopes: artifacts.rowCount ?? artifacts.rows.length, hiddenTestEnvelopes: hiddenTests.rowCount ?? hiddenTests.rows.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function storeSignedTestEvidence(input: {
  id: string; taskId: string; workRound: number; checkpoint: number; panelEpoch: number; verificationShard: number; testerAgentId: string; testerAddress: string; artifactHash: string; reportHash: string; report: unknown; signature: string;
  signingVersion: "AgentGrid Test Evidence V4"; signingMessage: string;
}) {
  await migratePostgres();
  const result = await databasePool().query<{
    id: string; taskId: string; workRound: number; checkpoint: number; panelEpoch: number; verificationShard: number; testerAgentId: string; testerAddress: string; artifactHash: string; reportHash: string; signature: string; signingVersion: string; signingMessage: string;
  }>(
    `INSERT INTO signed_test_evidence(id,task_id,work_round,checkpoint,panel_epoch,verification_shard,tester_agent_id,tester_address,artifact_hash,report_hash,report,signature,signing_version,signing_message)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) ON CONFLICT DO NOTHING
     RETURNING id,task_id AS "taskId",work_round AS "workRound",checkpoint,panel_epoch AS "panelEpoch",verification_shard AS "verificationShard",tester_agent_id AS "testerAgentId",tester_address AS "testerAddress",
       artifact_hash AS "artifactHash",report_hash AS "reportHash",signature,signing_version AS "signingVersion",signing_message AS "signingMessage"`,
    [input.id, input.taskId, input.workRound, input.checkpoint, input.panelEpoch, input.verificationShard, input.testerAgentId, input.testerAddress.toLowerCase(), input.artifactHash, input.reportHash, JSON.stringify(input.report), input.signature, input.signingVersion, input.signingMessage],
  );
  if (result.rows[0]) return result.rows[0];
  const existing = await databasePool().query<{
    id: string; taskId: string; workRound: number; checkpoint: number; panelEpoch: number; verificationShard: number; testerAgentId: string; testerAddress: string; artifactHash: string; reportHash: string; signature: string; signingVersion: string | null; signingMessage: string | null;
  }>(
    `SELECT id,task_id AS "taskId",work_round AS "workRound",checkpoint,panel_epoch AS "panelEpoch",verification_shard AS "verificationShard",tester_agent_id AS "testerAgentId",tester_address AS "testerAddress",
       artifact_hash AS "artifactHash",report_hash AS "reportHash",signature,signing_version AS "signingVersion",signing_message AS "signingMessage"
     FROM signed_test_evidence WHERE task_id=$1 AND work_round=$2 AND checkpoint=$3 AND panel_epoch=$4 AND LOWER(tester_address)=LOWER($5)`,
    [input.taskId, input.workRound, input.checkpoint, input.panelEpoch, input.testerAddress],
  );
  const row = existing.rows[0];
  if (row && row.testerAgentId === input.testerAgentId && row.testerAddress.toLowerCase() === input.testerAddress.toLowerCase()
    && row.artifactHash === input.artifactHash && row.signature.toLowerCase() === input.signature.toLowerCase()
    && row.signingVersion === input.signingVersion && row.signingMessage === input.signingMessage) return { ...row, signingVersion: input.signingVersion, signingMessage: input.signingMessage };
  throw new Error("TEST_EVIDENCE_EQUIVOCATION_REJECTED");
}

export async function evaluationTaskForAgent(taskId: string, evaluatorAddress: string) {
  await migratePostgres();
  const result = await databasePool().query<{
    taskId: string; publisher: string; spec: Record<string, unknown>; deadline: string; selectionProof: string;
  }>(
    `SELECT c.chain_task_id::text AS "taskId",c.publisher,
       c.spec - 'hiddenTestManifestId' - 'hiddenTestPlaintextSha256' AS spec,
       requested.event_args->>'deadline' AS deadline,
       assigned.event_args->>'selectionProof' AS "selectionProof"
     FROM task_commitments c
     JOIN LATERAL (
       SELECT event_args FROM chain_events WHERE event_name='TaskEvaluationRequested' AND event_args->>'taskId'=c.chain_task_id::text
       ORDER BY block_number DESC,log_index DESC LIMIT 1
     ) requested ON TRUE
     JOIN LATERAL (
       SELECT event_args FROM chain_events WHERE event_name='TaskEvaluatorsAssigned' AND event_args->>'taskId'=c.chain_task_id::text
         AND LOWER($2) IN (LOWER(event_args->>'evaluator0'),LOWER(event_args->>'evaluator1'),LOWER(event_args->>'evaluator2'))
       ORDER BY block_number DESC,log_index DESC LIMIT 1
     ) assigned ON TRUE
     WHERE c.chain_task_id=$1 AND c.status IN ('EVALUATING','APPROVED','CONFIRMED','REJECTED')`,
    [taskId, evaluatorAddress],
  );
  if (!result.rows[0]) throw new Error("TASK_EVALUATION_NOT_ASSIGNED");
  return result.rows[0];
}

export async function storeSignedTaskEvaluation(input: {
  id: string; taskId: string; evaluatorAgentId: string; evaluatorAddress: string; approve: boolean;
  reportHash: string; report: unknown; signature: string;
  signingVersion: "AgentGrid Task Evaluation V2"; signingMessage: string;
}) {
  await migratePostgres();
  const result = await databasePool().query(
    `INSERT INTO signed_task_evaluations(id,task_id,evaluator_agent_id,evaluator_address,approve,report_hash,report,signature,signing_version,signing_message)
     SELECT $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10
     WHERE EXISTS(SELECT 1 FROM task_commitments WHERE chain_task_id::text=$2 AND status='EVALUATING')
     ON CONFLICT DO NOTHING
     RETURNING id,task_id AS "taskId",report_hash AS "reportHash"`,
    [input.id, input.taskId, input.evaluatorAgentId, input.evaluatorAddress.toLowerCase(), input.approve, input.reportHash, JSON.stringify(input.report), input.signature, input.signingVersion, input.signingMessage],
  );
  if (!result.rows[0]) {
    const existing = await databasePool().query<{ id: string; taskId: string; evaluatorAgentId: string; evaluatorAddress: string; approve: boolean; reportHash: string; signature: string; signingVersion: string | null; signingMessage: string | null }>(
      `SELECT id,task_id AS "taskId",evaluator_agent_id AS "evaluatorAgentId",evaluator_address AS "evaluatorAddress",
         approve,report_hash AS "reportHash",signature,signing_version AS "signingVersion",signing_message AS "signingMessage" FROM signed_task_evaluations
       WHERE task_id=$1 AND evaluator_address=$2`, [input.taskId, input.evaluatorAddress.toLowerCase()],
    );
    if (existing.rows[0]?.reportHash === input.reportHash && existing.rows[0].signature.toLowerCase() === input.signature.toLowerCase()
      && existing.rows[0].evaluatorAgentId === input.evaluatorAgentId && existing.rows[0].evaluatorAddress.toLowerCase() === input.evaluatorAddress.toLowerCase()
      && existing.rows[0].approve === input.approve && existing.rows[0].signingVersion === input.signingVersion
      && existing.rows[0].signingMessage === input.signingMessage) {
      return { id: existing.rows[0].id, taskId: existing.rows[0].taskId, reportHash: existing.rows[0].reportHash };
    }
    if (existing.rows[0]) throw new Error("TASK_EVALUATION_EQUIVOCATION_REJECTED");
    throw new Error("TASK_NOT_ACCEPTING_EVALUATION");
  }
  return result.rows[0];
}

export interface SignedTaskEvaluationRow {
  taskId: string; evaluatorAddress: string; approve: boolean; reportHash: string;
  report: Record<string, unknown>; signature: string; signingVersion: string | null; signingMessage: string | null; createdAt: string;
}

export async function latestSignedTaskEvaluations() {
  await migratePostgres();
  const result = await databasePool().query<SignedTaskEvaluationRow>(
    `SELECT task_id AS "taskId",evaluator_address AS "evaluatorAddress",approve,report_hash AS "reportHash",
       report,signature,signing_version AS "signingVersion",signing_message AS "signingMessage",created_at::text AS "createdAt"
     FROM signed_task_evaluations ORDER BY task_id,created_at`,
  );
  return result.rows;
}

export interface SignedTestEvidenceRow {
  taskId: string; workRound: number; checkpoint: number; panelEpoch: number; verificationShard: number; testerAddress: string; artifactHash: string; reportHash: string;
  report: Record<string, unknown>; signature: string; signingVersion: string | null; signingMessage: string | null; createdAt: string;
}

export async function latestSignedTestEvidence() {
  await migratePostgres();
  const result = await databasePool().query<SignedTestEvidenceRow>(
    `SELECT DISTINCT ON (task_id,work_round,checkpoint,panel_epoch,LOWER(tester_address)) task_id AS "taskId",work_round AS "workRound",checkpoint,panel_epoch AS "panelEpoch",verification_shard AS "verificationShard",tester_address AS "testerAddress",artifact_hash AS "artifactHash",
       report_hash AS "reportHash",report,signature,signing_version AS "signingVersion",signing_message AS "signingMessage",created_at::text AS "createdAt"
     FROM signed_test_evidence WHERE work_round IS NOT NULL AND checkpoint IS NOT NULL AND panel_epoch IS NOT NULL AND verification_shard IS NOT NULL
     ORDER BY task_id,work_round,checkpoint,panel_epoch,LOWER(tester_address),created_at DESC`,
  );
  return result.rows;
}

export interface JobOutboxRow { id: string; role: "EXECUTOR" | "TESTER" | "EVALUATOR" | "COORDINATOR"; kind: string; payload: Record<string, unknown>; createdAt: string }

export async function pendingJobOutbox(limit = 100) {
  await migratePostgres();
  const result = await databasePool().query<JobOutboxRow>(
    `SELECT id,role,kind,payload,created_at::text AS "createdAt" FROM job_outbox
     WHERE dispatched_at IS NULL ORDER BY created_at LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function expiredTaskEvaluations(limit = 100) {
  await migratePostgres();
  const result = await databasePool().query<{ taskId: string; deadline: string }>(
    `SELECT c.chain_task_id::text AS "taskId",latest.deadline
     FROM task_commitments c
     JOIN LATERAL (
       SELECT event_args->>'deadline' AS deadline FROM chain_events
       WHERE event_name='TaskEvaluationRequested' AND event_args->>'taskId'=c.chain_task_id::text
       ORDER BY block_number DESC,log_index DESC LIMIT 1
     ) latest ON TRUE
     WHERE c.status='EVALUATING' AND latest.deadline::numeric < EXTRACT(EPOCH FROM NOW())
     ORDER BY latest.deadline::numeric LIMIT $1`, [limit],
  );
  return result.rows;
}

export async function markJobOutboxDispatched(id: string) {
  await databasePool().query("UPDATE job_outbox SET dispatched_at=NOW() WHERE id=$1 AND dispatched_at IS NULL", [id]);
}

export async function operationalDatabaseMetrics() {
  await migratePostgres();
  const result = await databasePool().query<{
    chainEvents: string; confirmedTasks: string; pendingOutbox: string; readyArtifacts: string; signedEvidence: string; businessAdoptions: string; unreadNotifications: string; auditEvents24h: string; artifactReleases24h: string; expiredEvaluations: string;
    qualityLowValueIgnored1h: string; qualitySelfDealingIgnored1h: string; qualityRelationshipCapIgnored1h: string;
    latestIndexedBlock: string | null; chainCursorAgeSeconds: string | null; pendingOutboxOldestSeconds: string | null; lastNotificationAgeSeconds: string | null;
  }>(`SELECT
    (SELECT COUNT(*) FROM chain_events)::text AS "chainEvents",
    (SELECT COUNT(*) FROM task_commitments WHERE status='CONFIRMED')::text AS "confirmedTasks",
    (SELECT COUNT(*) FROM job_outbox WHERE dispatched_at IS NULL)::text AS "pendingOutbox",
    (SELECT COUNT(*) FROM artifact_manifests WHERE status='READY')::text AS "readyArtifacts",
    (SELECT COUNT(*) FROM signed_test_evidence)::text AS "signedEvidence",
    (SELECT COUNT(*) FROM business_adoption_attestations)::text AS "businessAdoptions",
    (SELECT COUNT(*) FROM notifications WHERE read_at IS NULL)::text AS "unreadNotifications",
    (SELECT COUNT(*) FROM audit_events WHERE created_at > NOW()-INTERVAL '24 hours')::text AS "auditEvents24h",
    (SELECT COUNT(*) FROM artifact_release_audit WHERE created_at > NOW()-INTERVAL '24 hours')::text AS "artifactReleases24h",
    (SELECT COUNT(*) FROM task_commitments c WHERE c.status='EVALUATING' AND EXISTS(
      SELECT 1 FROM chain_events e WHERE e.event_name='TaskEvaluationRequested' AND e.event_args->>'taskId'=c.chain_task_id::text
      AND (e.event_args->>'deadline')::numeric < EXTRACT(EPOCH FROM NOW())
    ))::text AS "expiredEvaluations",
    (SELECT COUNT(*) FROM chain_events WHERE event_name='AgentQualityOutcomeIgnored'
      AND LOWER(event_args->>'reason')=$1
      AND block_timestamp > NOW()-INTERVAL '1 hour')::text AS "qualityLowValueIgnored1h",
    (SELECT COUNT(*) FROM chain_events WHERE event_name='AgentQualityOutcomeIgnored'
      AND LOWER(event_args->>'reason')=$2
      AND block_timestamp > NOW()-INTERVAL '1 hour')::text AS "qualitySelfDealingIgnored1h",
    (SELECT COUNT(*) FROM chain_events WHERE event_name='AgentQualityOutcomeIgnored'
      AND LOWER(event_args->>'reason')=$3
      AND block_timestamp > NOW()-INTERVAL '1 hour')::text AS "qualityRelationshipCapIgnored1h",
    (SELECT MAX(block_number) FROM chain_events)::text AS "latestIndexedBlock",
    (SELECT EXTRACT(EPOCH FROM NOW()-MAX(updated_at)) FROM chain_cursors)::text AS "chainCursorAgeSeconds",
    (SELECT EXTRACT(EPOCH FROM NOW()-MIN(created_at)) FROM job_outbox WHERE dispatched_at IS NULL)::text AS "pendingOutboxOldestSeconds",
    (SELECT EXTRACT(EPOCH FROM NOW()-MAX(created_at)) FROM notifications)::text AS "lastNotificationAgeSeconds"`, [
      keccak256(stringToHex("LOW_VALUE_TASK")).toLowerCase(),
      keccak256(stringToHex("SELF_DEALING_RELATIONSHIP")).toLowerCase(),
      keccak256(stringToHex("RELATIONSHIP_EPOCH_CAP")).toLowerCase(),
    ]);
  return Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, value === null ? null : Number(value)]));
}

export async function readPostgresDatabase(initialState: ProtocolDatabase): Promise<ProtocolDatabase> {
  await migratePostgres(initialState);
  const result = await databasePool().query<{ data: ProtocolDatabase }>("SELECT data FROM protocol_state WHERE singleton=TRUE");
  if (!result.rows[0]) throw new Error("PROTOCOL_STATE_NOT_INITIALIZED");
  return result.rows[0].data;
}

export async function updatePostgresDatabase<T>(initialState: ProtocolDatabase, mutation: (database: ProtocolDatabase) => T | Promise<T>): Promise<T> {
  await migratePostgres(initialState);
  const client = await databasePool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ data: ProtocolDatabase }>("SELECT data FROM protocol_state WHERE singleton=TRUE FOR UPDATE");
    const database = result.rows[0]?.data;
    if (!database) throw new Error("PROTOCOL_STATE_NOT_INITIALIZED");
    const output = await mutation(database);
    await client.query("UPDATE protocol_state SET data=$1::jsonb, version=version+1, updated_at=NOW() WHERE singleton=TRUE", [JSON.stringify(database)]);
    await client.query("COMMIT");
    return output;
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

async function rollback(client: PoolClient) {
  try { await client.query("ROLLBACK"); } catch { /* preserve the original transaction error */ }
}

export async function postgresReady() {
  const result = await databasePool().query<{ ready: number }>("SELECT 1 AS ready");
  return result.rows[0]?.ready === 1;
}

async function pruneExpiredAuthNonces() {
  const result = await databasePool().query(
    "DELETE FROM auth_nonces WHERE expires_at < NOW()-($1 * INTERVAL '1 hour')",
    [transientSecurityRetentionHours],
  );
  return result.rowCount ?? 0;
}

async function pruneInactiveRateLimits() {
  const result = await databasePool().query(
    "DELETE FROM rate_limits WHERE window_start < NOW()-($1 * INTERVAL '1 hour')",
    [transientSecurityRetentionHours],
  );
  return result.rowCount ?? 0;
}

export async function pruneTransientSecurityState() {
  await migratePostgres();
  const [authNonces, rateLimits] = await Promise.all([pruneExpiredAuthNonces(), pruneInactiveRateLimits()]);
  return { authNonces, rateLimits, retentionHours: transientSecurityRetentionHours };
}

export async function storeAuthNonce(nonceHash: string, messageHash: string, address: string, chainId: number, expiresAt: Date) {
  await migratePostgres();
  await pruneExpiredAuthNonces();
  await databasePool().query(
    "INSERT INTO auth_nonces(nonce_hash,message_hash,address,chain_id,expires_at) VALUES($1,$2,$3,$4,$5)",
    [nonceHash, messageHash, address.toLowerCase(), chainId, expiresAt],
  );
}

export async function consumeAuthNonce(nonceHash: string, messageHash: string, address: string, chainId: number) {
  const result = await databasePool().query(
    `UPDATE auth_nonces SET consumed_at=NOW()
     WHERE nonce_hash=$1 AND message_hash=$2 AND address=$3 AND chain_id=$4 AND consumed_at IS NULL AND expires_at>NOW()
     RETURNING nonce_hash`,
    [nonceHash, messageHash, address.toLowerCase(), chainId],
  );
  return result.rowCount === 1;
}

export async function appendAuditEvent(input: { actor: string; action: string; target?: string; requestId?: string; payload?: unknown }) {
  await databasePool().query(
    "INSERT INTO audit_events(id,actor,action,target,request_id,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
    [randomUUID(), input.actor, input.action, input.target ?? null, input.requestId ?? null, JSON.stringify(input.payload ?? {})],
  );
}

export async function consumePostgresRateLimit(key: string, limit: number, windowSeconds: number) {
  await migratePostgres();
  await pruneInactiveRateLimits();
  const result = await databasePool().query<{ count: number }>(
    `INSERT INTO rate_limits(key,window_start,count) VALUES($1,NOW(),1)
     ON CONFLICT(key) DO UPDATE SET
       window_start=CASE WHEN rate_limits.window_start < NOW()-($2 * INTERVAL '1 second') THEN NOW() ELSE rate_limits.window_start END,
       count=CASE WHEN rate_limits.window_start < NOW()-($2 * INTERVAL '1 second') THEN 1 ELSE rate_limits.count+1 END
     RETURNING count`,
    [key, windowSeconds],
  );
  return (result.rows[0]?.count ?? limit + 1) <= limit;
}

export async function closePostgresForTests() {
  await pool?.end();
  pool = undefined;
  migrated = false;
}
