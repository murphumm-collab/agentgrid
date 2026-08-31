import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const exec = promisify(execFile);
const database = `agentgrid_rotation_smoke_${Date.now()}`;

async function postgres(args: string[]) {
  return exec("docker", ["compose", "exec", "-T", "postgres", ...args], { cwd: process.cwd() });
}

async function main() {
  if (!/^agentgrid_rotation_smoke_\d+$/.test(database)) throw new Error("ROTATION_SMOKE_DATABASE_NAME_INVALID");
  await postgres(["createdb", "-U", "agentgrid", database]);
  process.env.PROTOCOL_MODE = "production";
  process.env.DATABASE_URL = `postgresql://agentgrid:local-agentgrid-password@127.0.0.1:5432/${database}`;
  process.env.AUTH_SECRET = "rotation-smoke-session-secret-32-characters";
  const oldMasterKey = "44".repeat(32);
  const newMasterKey = "55".repeat(32);
  process.env.ARTIFACT_MASTER_KEY = oldMasterKey;
  delete process.env.ARTIFACT_PREVIOUS_MASTER_KEYS;

  const { resetRuntimeConfigForTests } = await import("../src/lib/env");
  resetRuntimeConfigForTests();
  const { sealArtifactKey, openArtifactKey } = await import("../src/lib/artifact-crypto");
  const store = await import("../src/lib/store-postgres");
  const rawKey = Buffer.alloc(32, 7).toString("base64");
  const oldEnvelope = sealArtifactKey(rawKey);
  const artifactId = randomUUID();
  const hiddenId = randomUUID();
  const agentId = "rotation-smoke-agent";
  const publisher = "0x1111111111111111111111111111111111111111";

  try {
    await store.migratePostgres();
    await store.createArtifactManifest({
      id: artifactId, taskId: "rotation-smoke-task", agentId, objectKey: `rotation-smoke/${artifactId}`,
      sha256: "a".repeat(64), plaintextSha256: "b".repeat(64), sizeBytes: 1, contentType: "application/gzip",
      encryptionAlgorithm: "AES-256-GCM", contentIv: Buffer.alloc(12).toString("base64"), ...oldEnvelope,
    });
    await store.createHiddenTestManifest({
      id: hiddenId, publisher, objectKey: `rotation-smoke/${hiddenId}`, sha256: "c".repeat(64), plaintextSha256: "d".repeat(64),
      sizeBytes: 1, contentType: "application/gzip", encryptionAlgorithm: "AES-256-GCM",
      contentIv: Buffer.alloc(12, 1).toString("base64"), ...oldEnvelope,
    });

    process.env.ARTIFACT_MASTER_KEY = newMasterKey;
    process.env.ARTIFACT_PREVIOUS_MASTER_KEYS = oldMasterKey;
    resetRuntimeConfigForTests();
    const rotated = await store.rotateArtifactMasterKeyEnvelopes();

    delete process.env.ARTIFACT_PREVIOUS_MASTER_KEYS;
    resetRuntimeConfigForTests();
    const artifact = await store.artifactManifest(artifactId, agentId);
    const hidden = await store.hiddenTestManifest(hiddenId, publisher);
    if (openArtifactKey(artifact) !== rawKey || openArtifactKey(hidden) !== rawKey) throw new Error("ROTATED_KEY_CANNOT_BE_OPENED_WITH_NEW_MASTER_KEY");
    let oldEnvelopeRejected = false;
    try { openArtifactKey(oldEnvelope); } catch { oldEnvelopeRejected = true; }
    if (!oldEnvelopeRejected) throw new Error("OLD_ENVELOPE_STILL_OPENED_WITHOUT_OLD_MASTER_KEY");
    console.log(JSON.stringify({ disposableDatabase: true, ...rotated, newKeyOnlyVerified: true, oldEnvelopeRejected: true }));
  } finally {
    await store.closePostgresForTests();
    await postgres(["dropdb", "-U", "agentgrid", "--if-exists", database]);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
