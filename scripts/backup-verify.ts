import { backupRestoreReportSchema } from "../src/lib/backup-evidence";
import { resolveBackupFolder, restoreVerifiedBackupDump, verifyLocalBackup, writeNewEvidenceFile } from "./backup-restore";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function main() {
  const backup = await verifyLocalBackup(await resolveBackupFolder());
  const restore = await restoreVerifiedBackupDump(backup.dumpPath);
  let evidenceFile: string | null = null;
  if (process.env.BACKUP_RESTORE_REPORT_FILE) {
    const report = backupRestoreReportSchema.parse({
      version: 1,
      scope: "agentgrid-backup-restore",
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
      restore: { ...restore, source: "local" },
    });
    evidenceFile = await writeNewEvidenceFile(process.env.BACKUP_RESTORE_REPORT_FILE, report);
  }
  console.log(JSON.stringify({
    backup: backup.folder, checksumVerified: true, restored: true, coreTables: restore.coreTables,
    streamedRestore: true, isolatedDatabaseDropped: restore.isolatedDatabaseDropped, evidenceFile,
  }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "BACKUP_VERIFY_FAILED");
  process.exitCode = 1;
});
