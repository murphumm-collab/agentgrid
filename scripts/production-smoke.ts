import { randomBytes, randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

async function main() {
  const { runtimeConfig } = await import("../src/lib/env");
  if (runtimeConfig().PROTOCOL_MODE !== "production") throw new Error("Production smoke test requires PROTOCOL_MODE=production");
  const {
    businessAdoptionForTask,
    closePostgresForTests,
    postgresReady,
    recordArtifactRelease,
    storeBusinessAdoption,
  } = await import("../src/lib/store-postgres");
  const { readDatabase, updateDatabase } = await import("../src/lib/store");
  const { createWalletChallenge, readWalletSession, verifyWalletChallenge } = await import("../src/lib/auth");
  if (!await postgresReady()) throw new Error("PostgreSQL is not ready");
  const marker = `smoke-${Date.now()}`;
  await updateDatabase((database) => { database.balances[marker] = 1; });
  const persisted = await readDatabase();
  if (persisted.balances[marker] !== 1) throw new Error("Transactional state did not persist");
  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const challenge = await createWalletChallenge(account.address);
  const signature = await account.signMessage({ message: challenge.message });
  const verified = await verifyWalletChallenge({ address: account.address, nonce: challenge.nonce, message: challenge.message, signature });
  const session = await readWalletSession(verified.token);
  if (session?.address !== account.address || session.chainId !== 97) throw new Error("Wallet session verification failed");
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
  console.log(JSON.stringify({ postgres: true, transactionalState: true, walletNonce: true, signedSession: true, businessAdoption: true, duplicateAdoptionRejected: true, replacementAdoptionAppended: true }, null, 2));
  await closePostgresForTests();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
