import { createHash } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { offsiteBackupReportSchema } from "../src/lib/backup-evidence";
import { backupObjectStorageConfiguration } from "./backup";
import {
  resolveBackupFolder, restoreVerifiedBackupDump, verifyLocalBackup, writeNewEvidenceFile,
} from "./backup-restore";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sha256(bytes: Buffer | string) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function boundedBody(body: unknown, maximum: number) {
  if (!body || typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function") throw new Error("BACKUP_OFFHOST_BODY_MISSING");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    const value = Buffer.from(chunk);
    bytes += value.length;
    if (bytes > maximum) throw new Error("BACKUP_OFFHOST_BODY_TOO_LARGE");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function downloadDump(body: unknown, filename: string, expectedBytes: number, expectedSha256: string) {
  if (!body || typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function") throw new Error("BACKUP_OFFHOST_BODY_MISSING");
  const handle = await fs.open(filename, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  const digest = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      const value = Buffer.from(chunk);
      bytes += value.length;
      if (bytes > expectedBytes) throw new Error("BACKUP_OFFHOST_DUMP_SIZE_MISMATCH");
      digest.update(value);
      await handle.write(value);
    }
  } finally { await handle.close(); }
  if (bytes !== expectedBytes) throw new Error("BACKUP_OFFHOST_DUMP_SIZE_MISMATCH");
  if (digest.digest("hex") !== expectedSha256) throw new Error("BACKUP_OFFHOST_DUMP_SHA256_MISMATCH");
}

async function main() {
  const evidenceFilename = required("OFFSITE_BACKUP_REPORT_FILE");
  const backup = await verifyLocalBackup(await resolveBackupFolder());
  if (!backup.manifest.offHost) throw new Error("BACKUP_OFFHOST_MANIFEST_MISSING");
  const configuration = backupObjectStorageConfiguration();
  if (backup.manifest.offHost.bucket !== configuration.bucket
    || !backup.manifest.offHost.prefix.startsWith(`${configuration.prefix}/`)
    || backup.manifest.offHost.endpointClass !== configuration.endpointClass) throw new Error("BACKUP_OFFHOST_CONFIGURATION_MISMATCH");
  const manifestKey = `${backup.manifest.offHost.prefix}/manifest.json`;
  const dumpKey = `${backup.manifest.offHost.prefix}/postgres.dump`;
  const remoteManifest = await configuration.client.send(new GetObjectCommand({ Bucket: configuration.bucket, Key: manifestKey }));
  const remoteManifestBytes = await boundedBody(remoteManifest.Body, 1024 * 1024);
  if (!remoteManifestBytes.equals(backup.manifestBytes)) throw new Error("BACKUP_OFFHOST_MANIFEST_BYTES_MISMATCH");
  const remoteDump = await configuration.client.send(new GetObjectCommand({ Bucket: configuration.bucket, Key: dumpKey, ChecksumMode: "ENABLED" }));
  if (remoteDump.ContentLength !== backup.manifest.postgres.bytes) throw new Error("BACKUP_OFFHOST_CONTENT_LENGTH_MISMATCH");
  if (remoteDump.Metadata?.sha256 !== backup.manifest.postgres.sha256) throw new Error("BACKUP_OFFHOST_METADATA_SHA256_MISMATCH");
  const expectedEncryption = backup.manifest.offHost.encryption === "none-local-smoke" ? undefined : backup.manifest.offHost.encryption;
  if (remoteDump.ServerSideEncryption !== expectedEncryption) throw new Error("BACKUP_OFFHOST_ENCRYPTION_MISMATCH");

  const temporary = await fs.mkdtemp(path.join(tmpdir(), "agentgrid-offhost-restore-"));
  try {
    const dumpPath = path.join(temporary, "postgres.dump");
    await downloadDump(remoteDump.Body, dumpPath, backup.manifest.postgres.bytes, backup.manifest.postgres.sha256);
    const restore = await restoreVerifiedBackupDump(dumpPath);
    const report = offsiteBackupReportSchema.parse({
      version: 1,
      scope: "agentgrid-offsite-backup-restore",
      observedAt: new Date().toISOString(),
      chainId: 97,
      candidateBuildId: required("BACKUP_EVIDENCE_CANDIDATE_BUILD_ID"),
      deploymentManifestSha256: required("BACKUP_EVIDENCE_DEPLOYMENT_MANIFEST_SHA256"),
      backup: {
        createdAt: backup.manifest.createdAt,
        manifestSha256: backup.manifestSha256,
        dumpSha256: `sha256:${backup.manifest.postgres.sha256}`,
        bytes: backup.manifest.postgres.bytes,
      },
      remote: {
        endpointClass: configuration.endpointClass,
        bucketHash: sha256(configuration.bucket),
        objectPrefixHash: sha256(backup.manifest.offHost.prefix),
        encryption: backup.manifest.offHost.encryption,
        contentLengthVerified: true,
        metadataSha256Verified: true,
        manifestBytesVerified: true,
        dumpSha256Verified: true,
      },
      restore: { ...restore, source: "off-host-download" },
    });
    const output = await writeNewEvidenceFile(evidenceFilename, report);
    console.log(JSON.stringify({ offsiteBackupVerified: true, streamedDownload: true, restored: true, coreTables: 11, output, endpointClass: configuration.endpointClass }));
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "BACKUP_OFFHOST_VERIFY_FAILED");
  process.exitCode = 1;
});
