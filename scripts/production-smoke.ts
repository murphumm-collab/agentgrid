import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

async function main() {
  const { runtimeConfig } = await import("../src/lib/env");
  if (runtimeConfig().PROTOCOL_MODE !== "production") throw new Error("Production smoke test requires PROTOCOL_MODE=production");
  const {
    businessAdoptionForTask,
    closePostgresForTests,
    postgresReady,
    pruneTransientSecurityState,
    recordArtifactRelease,
    storeBusinessAdoption,
    storeSignedTaskEvaluation,
    storeSignedTestEvidence,
  } = await import("../src/lib/store-postgres");
  const { readDatabase, updateDatabase } = await import("../src/lib/store");
  const { createWalletChallenge, readWalletSession, verifyWalletChallenge } = await import("../src/lib/auth");
  const { revokeAgentCredential, rotateAgentCredential } = await import("../src/lib/service");
  const { taskEvaluationMessage, taskEvaluationSigningVersion, verifyStoredTaskEvaluation } = await import("../src/lib/task-evaluation");
  const { evidenceMessage, testEvidenceSigningVersion, verifyStoredTestEvidence } = await import("../src/lib/signed-evidence");
  if (!await postgresReady()) throw new Error("PostgreSQL is not ready");
  const marker = `smoke-${Date.now()}`;
  await updateDatabase((database) => { database.balances[marker] = 1; });
  const persisted = await readDatabase();
  if (persisted.balances[marker] !== 1) throw new Error("Transactional state did not persist");
  const transientMarker = randomBytes(16).toString("hex");
  const transientClient = new Client({ connectionString: runtimeConfig().DATABASE_URL });
  await transientClient.connect();
  try {
    await transientClient.query(
      `INSERT INTO auth_nonces(nonce_hash,message_hash,address,chain_id,expires_at,consumed_at)
       VALUES($1,$2,$3,97,NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days')`,
      [`stale-nonce-${transientMarker}`, `stale-message-${transientMarker}`, `0x${"1".repeat(40)}`],
    );
    await transientClient.query(
      "INSERT INTO rate_limits(key,window_start,count) VALUES($1,NOW()-INTERVAL '2 days',999)",
      [`stale-rate-${transientMarker}`],
    );
    const pruned = await pruneTransientSecurityState();
    if (pruned.authNonces < 1 || pruned.rateLimits < 1 || pruned.retentionHours !== 24) {
      throw new Error("TRANSIENT_SECURITY_RETENTION_PRUNE_MISSING");
    }
    const remaining = await transientClient.query<{ total: number }>(
      `SELECT (
        (SELECT COUNT(*) FROM auth_nonces WHERE nonce_hash=$1) +
        (SELECT COUNT(*) FROM rate_limits WHERE key=$2)
      )::INTEGER AS total`,
      [`stale-nonce-${transientMarker}`, `stale-rate-${transientMarker}`],
    );
    if (remaining.rows[0]?.total !== 0) throw new Error("TRANSIENT_SECURITY_RETENTION_PRUNE_FAILED");
  } finally {
    await transientClient.end();
  }
  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const challenge = await createWalletChallenge(account.address);
  const signature = await account.signMessage({ message: challenge.message });
  const verified = await verifyWalletChallenge({ address: account.address, nonce: challenge.nonce, message: challenge.message, signature });
  const session = await readWalletSession(verified.token);
  if (session?.address !== account.address || session.chainId !== 97) throw new Error("Wallet session verification failed");
  const credentialAgentId = `agent-credential-smoke-${randomUUID()}`;
  await updateDatabase((database) => {
    database.agents.push({
      id: credentialAgentId, name: "Credential lifecycle smoke", owner: account.address,
      role: "EXECUTOR", capabilities: ["smoke"], endpoint: "https://agent.invalid/jobs",
      apiKey: "amp_old_smoke_key", stake: 0, reputation: 0, completedTasks: 0, online: true,
    });
  });
  try {
    const rotated = await rotateAgentCredential(credentialAgentId, account.address.toLowerCase());
    if (!rotated.apiKey.startsWith("amp_") || "apiKeyHash" in rotated.agent || "apiKeySalt" in rotated.agent) throw new Error("Credential rotation leaked verifier fields");
    const storedRotation = (await readDatabase()).agents.find((agent) => agent.id === credentialAgentId);
    if (!storedRotation?.apiKeyHash || !storedRotation.apiKeySalt || storedRotation.apiKey) throw new Error("Credential rotation did not persist only a verifier");
    const revoked = await revokeAgentCredential(credentialAgentId, account.address);
    const storedRevocation = (await readDatabase()).agents.find((agent) => agent.id === credentialAgentId);
    if (!revoked.revokedAt || storedRevocation?.revokedAt !== revoked.revokedAt || storedRevocation?.online !== false) throw new Error("Credential revocation did not persist offline state");
    if (storedRevocation?.apiKey || storedRevocation?.apiKeyHash || storedRevocation?.apiKeySalt) throw new Error("Credential revocation retained old verifier material");
  } finally {
    await updateDatabase((database) => { database.agents = database.agents.filter((agent) => agent.id !== credentialAgentId); });
  }
  const taskId = `${Date.now()}`;
  const releaseId = randomUUID();
  const artifactHash = `sha256:${"a".repeat(64)}`;
  const adoptedAt = new Date().toISOString();
  const reportHash = () => `0x${randomBytes(32).toString("hex")}`;
  await recordArtifactRelease({ id: releaseId, taskId, artifactId: randomUUID(), publisher: account.address, chainState: "MAINTENANCE", artifactHash, expiresAt: new Date(Date.now() + 300_000) });
  const adoption = {
    id: randomUUID(), taskId, publisher: account.address, releaseId, chainId: 97, artifactHash,
    workflowType: "INTERNAL_WORKFLOW" as const, workflowEvidenceHash: `sha256:${"b".repeat(64)}`,
    adoptedAt, reportHash: reportHash(), report: { smoke: true }, signature: `0x${"d".repeat(130)}`,
  };
  await storeBusinessAdoption(adoption);
  const persistedAdoption = await businessAdoptionForTask(taskId, artifactHash);
  if (persistedAdoption?.releaseId !== releaseId || persistedAdoption.artifactHash !== artifactHash) throw new Error("Business adoption did not persist");
  let duplicateRejected = false;
  try { await storeBusinessAdoption({ ...adoption, id: randomUUID(), reportHash: reportHash() }); }
  catch (error) { duplicateRejected = error instanceof Error && error.message === "BUSINESS_ADOPTION_ALREADY_RECORDED"; }
  if (!duplicateRejected) throw new Error("Duplicate business adoption was not rejected");
  const replacementReleaseId = randomUUID();
  const replacementArtifactHash = `sha256:${"f".repeat(64)}`;
  await recordArtifactRelease({ id: replacementReleaseId, taskId, artifactId: randomUUID(), publisher: account.address, chainState: "MAINTENANCE", artifactHash: replacementArtifactHash, expiresAt: new Date(Date.now() + 300_000) });
  await storeBusinessAdoption({
    ...adoption, id: randomUUID(), releaseId: replacementReleaseId, artifactHash: replacementArtifactHash,
    workflowEvidenceHash: `sha256:${"1".repeat(64)}`, reportHash: reportHash(),
  });
  if (!(await businessAdoptionForTask(taskId, replacementArtifactHash))) throw new Error("Replacement artifact adoption history did not append");
  const signedTaskId = `${Date.now() + 1}`;
  const evaluatorAddress = account.address;
  const testerAddress = account.address;
  const taskRegistry = `0x${"6".repeat(40)}`;
  const canonicalClient = new Client({ connectionString: runtimeConfig().DATABASE_URL });
  await canonicalClient.connect();
  try {
    await canonicalClient.query(
      `INSERT INTO task_commitments(id,publisher,spec_hash,spec,status,chain_task_id)
       VALUES($1,$2,$3,$4::jsonb,'EVALUATING',$5)`,
      [randomUUID(), account.address, `smoke-spec-${randomUUID()}`, JSON.stringify({ smoke: true }), signedTaskId],
    );
    const evaluationReport = {
      category: "Development", difficultyBps: 1_000, estimatedHours: 1, testabilityBps: 10_000,
      recommendedReward: 1, approve: true, reasons: ["The smoke verifies an exact persisted signing preimage."], risks: [],
    };
    const evaluationCommitment = taskEvaluationMessage({ chainId: 97, taskRegistry, taskId: signedTaskId, report: evaluationReport });
    const evaluationInput = {
      id: randomUUID(), taskId: signedTaskId, evaluatorAgentId: `evaluator-${randomUUID()}`, evaluatorAddress,
      approve: true, reportHash: evaluationCommitment.reportHash, report: evaluationReport,
      signature: await account.signMessage({ message: evaluationCommitment.message }),
      signingVersion: taskEvaluationSigningVersion, signingMessage: evaluationCommitment.message,
    };
    const storedEvaluation = await storeSignedTaskEvaluation(evaluationInput);
    const retriedEvaluation = await storeSignedTaskEvaluation({ ...evaluationInput, id: randomUUID() });
    if (retriedEvaluation.id !== storedEvaluation.id || retriedEvaluation.reportHash !== storedEvaluation.reportHash
      || Object.keys(retriedEvaluation).sort().join(",") !== "id,reportHash,taskId") throw new Error("SIGNED_EVALUATION_RETRY_NOT_CANONICAL");
    let evaluationConflictRejected = false;
    try { await storeSignedTaskEvaluation({ ...evaluationInput, id: randomUUID(), signingMessage: `${evaluationInput.signingMessage}-conflict` }); }
    catch (error) { evaluationConflictRejected = error instanceof Error && error.message === "TASK_EVALUATION_EQUIVOCATION_REJECTED"; }
    if (!evaluationConflictRejected) throw new Error("SIGNED_EVALUATION_EQUIVOCATION_NOT_REJECTED");

    const evidenceReport = {
      passed: true, exitCode: 0, timedOut: false, durationMs: 1, testsPassed: true, hiddenTestsPassed: true,
      lineCoverage: 1, branchCoverage: 1, functionCoverage: 1, criticalBranchCoverage: 1, stdout: "ok", stderr: "",
      sandbox: { network: "none" as const, readOnlyRoot: true as const, memoryMb: 256, cpus: 1, pids: 64, image: "agentgrid/smoke:fixed" },
      contributionWork: [], executorWeightsBps: [10_000],
    };
    const evidenceDomain = {
      chainId: 97 as const, taskRegistry, taskId: signedTaskId, workRound: 1, verificationShard: 0,
      executionMode: "COLLABORATION" as const, executorOrder: [`0x${"9".repeat(40)}`],
      artifactHash: `sha256:${"c".repeat(64)}`, report: evidenceReport,
    };
    const evidenceCommitment = evidenceMessage(evidenceDomain);
    const evidenceInput = {
      id: randomUUID(), taskId: signedTaskId, workRound: 1, verificationShard: 0, testerAgentId: `tester-${randomUUID()}`, testerAddress,
      artifactHash: evidenceDomain.artifactHash, reportHash: evidenceCommitment.reportHash, report: evidenceReport,
      signature: await account.signMessage({ message: evidenceCommitment.message }),
      signingVersion: testEvidenceSigningVersion, signingMessage: evidenceCommitment.message,
    };
    const storedEvidence = await storeSignedTestEvidence(evidenceInput);
    const retriedEvidence = await storeSignedTestEvidence({ ...evidenceInput, id: randomUUID() });
    if (retriedEvidence.id !== storedEvidence.id || retriedEvidence.signature !== storedEvidence.signature
      || retriedEvidence.testerAddress !== storedEvidence.testerAddress) throw new Error("SIGNED_EVIDENCE_RETRY_NOT_CANONICAL");
    let evidenceConflictRejected = false;
    try { await storeSignedTestEvidence({ ...evidenceInput, id: randomUUID(), signingMessage: `${evidenceInput.signingMessage}-conflict` }); }
    catch (error) { evidenceConflictRejected = error instanceof Error && error.message === "TEST_EVIDENCE_EQUIVOCATION_REJECTED"; }
    if (!evidenceConflictRejected) throw new Error("SIGNED_EVIDENCE_EQUIVOCATION_NOT_REJECTED");
    const persistedPreimages = await canonicalClient.query<{ kind: string; taskId: string; signer: string; artifactHash: string | null; reportHash: string; report: Record<string, unknown>; signature: Hex; signingVersion: string; signingMessage: string }>(
      `SELECT 'evaluation' AS kind,task_id AS "taskId",evaluator_address AS signer,NULL::TEXT AS "artifactHash",report_hash AS "reportHash",report,signature,signing_version AS "signingVersion",signing_message AS "signingMessage" FROM signed_task_evaluations WHERE task_id=$1
       UNION ALL
       SELECT 'evidence' AS kind,task_id AS "taskId",tester_address AS signer,artifact_hash AS "artifactHash",report_hash AS "reportHash",report,signature,signing_version AS "signingVersion",signing_message AS "signingMessage" FROM signed_test_evidence WHERE task_id=$1`,
      [signedTaskId],
    );
    if (persistedPreimages.rows.length !== 2
      || !persistedPreimages.rows.some((row) => row.kind === "evaluation" && row.signingVersion === evaluationInput.signingVersion && row.signingMessage === evaluationInput.signingMessage)
      || !persistedPreimages.rows.some((row) => row.kind === "evidence" && row.signingVersion === evidenceInput.signingVersion && row.signingMessage === evidenceInput.signingMessage)) {
      throw new Error("SIGNED_REPORT_PREIMAGE_NOT_PERSISTED");
    }
    const persistedEvaluation = persistedPreimages.rows.find((row) => row.kind === "evaluation")!;
    const persistedEvidence = persistedPreimages.rows.find((row) => row.kind === "evidence")!;
    if (!persistedEvidence.artifactHash) throw new Error("SIGNED_EVIDENCE_ARTIFACT_HASH_MISSING");
    const persistedEvidenceVerification = {
      taskId: persistedEvidence.taskId, testerAddress: persistedEvidence.signer, artifactHash: persistedEvidence.artifactHash,
      reportHash: persistedEvidence.reportHash, report: persistedEvidence.report, signature: persistedEvidence.signature,
      signingVersion: persistedEvidence.signingVersion, signingMessage: persistedEvidence.signingMessage, expectedTaskRegistry: taskRegistry,
      expectedWorkRound: evidenceDomain.workRound, expectedVerificationShard: evidenceDomain.verificationShard, expectedExecutionMode: evidenceDomain.executionMode, expectedExecutorOrder: evidenceDomain.executorOrder,
    };
    if (!await verifyStoredTaskEvaluation({
      taskId: persistedEvaluation.taskId, evaluatorAddress: persistedEvaluation.signer, reportHash: persistedEvaluation.reportHash,
      report: persistedEvaluation.report, signature: persistedEvaluation.signature, signingVersion: persistedEvaluation.signingVersion,
      signingMessage: persistedEvaluation.signingMessage, expectedTaskRegistry: taskRegistry,
    }) || !await verifyStoredTestEvidence(persistedEvidenceVerification)) throw new Error("SIGNED_REPORT_PREIMAGE_RECOVERY_FAILED");
    if (await verifyStoredTestEvidence({ ...persistedEvidenceVerification, expectedWorkRound: evidenceDomain.workRound + 1 })) {
      throw new Error("SIGNED_REPORT_STALE_WORK_ROUND_ACCEPTED");
    }
    await canonicalClient.query("UPDATE signed_test_evidence SET report=jsonb_set(report,'{stdout}',to_jsonb('tampered'::text)) WHERE task_id=$1", [signedTaskId]);
    const corrupted = (await canonicalClient.query<{ report: Record<string, unknown> }>("SELECT report FROM signed_test_evidence WHERE task_id=$1", [signedTaskId])).rows[0];
    if (!corrupted || await verifyStoredTestEvidence({ ...persistedEvidenceVerification, report: corrupted.report })) throw new Error("SIGNED_REPORT_CORRUPTION_ACCEPTED");
  } finally {
    await canonicalClient.query("DELETE FROM signed_task_evaluations WHERE task_id=$1", [signedTaskId]);
    await canonicalClient.query("DELETE FROM signed_test_evidence WHERE task_id=$1", [signedTaskId]);
    await canonicalClient.query("DELETE FROM task_commitments WHERE chain_task_id=$1", [signedTaskId]);
    await canonicalClient.end();
  }
  console.log(JSON.stringify({ postgres: true, transactionalState: true, transientSecurityRetention: true, walletNonce: true, signedSession: true, agentCredentialLifecycle: true, businessAdoption: true, duplicateAdoptionRejected: true, replacementAdoptionAppended: true, signedEvaluationRetryCanonical: true, signedEvidenceRetryCanonical: true, signedReportEquivocationRejected: true, signedReportPreimagePersisted: true, signedReportPreimageRecovered: true, signedReportCorruptionRejected: true, signedReportStaleContextRejected: true }, null, 2));
  await closePostgresForTests();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
