import { describe, expect, it } from "vitest";
import {
  backupEvidenceBindingBlockers, verifyBackupRestoreReport, verifyOffsiteBackupReport,
} from "./backup-evidence";

const base = Date.parse("2026-08-31T00:00:00.000Z");
const digest = (value: string) => `sha256:${value.repeat(64)}`;
const backup = {
  createdAt: new Date(base).toISOString(), manifestSha256: digest("1"), dumpSha256: digest("2"), bytes: 2048,
};
function local() {
  return {
    version: 1, scope: "agentgrid-backup-restore", observedAt: new Date(base + 20_000).toISOString(), chainId: 97,
    candidateBuildId: "candidate-build", deploymentManifestSha256: digest("3"), backup,
    restore: { completedAt: new Date(base + 10_000).toISOString(), source: "local", checksumVerified: true, coreTables: 10, isolatedDatabaseDropped: true },
  };
}
function offsite() {
  return {
    version: 1, scope: "agentgrid-offsite-backup-restore", observedAt: new Date(base + 40_000).toISOString(), chainId: 97,
    candidateBuildId: "candidate-build", deploymentManifestSha256: digest("3"), backup,
    remote: {
      endpointClass: "https-custom", bucketHash: digest("4"), objectPrefixHash: digest("5"), encryption: "aws:kms",
      contentLengthVerified: true, metadataSha256Verified: true, manifestBytesVerified: true, dumpSha256Verified: true,
    },
    restore: { completedAt: new Date(base + 30_000).toISOString(), source: "off-host-download", checksumVerified: true, coreTables: 10, isolatedDatabaseDropped: true },
  };
}

describe("backup release evidence", () => {
  it("accepts local and true off-host restores over one exact backup", () => {
    const left = verifyBackupRestoreReport(local(), new Date(base + 60_000));
    const right = verifyOffsiteBackupReport(offsite(), new Date(base + 60_000));
    expect(backupEvidenceBindingBlockers({
      local: left, offsite: right, candidateBuildId: "candidate-build",
      deploymentManifestSha256: digest("3"), releaseCreatedAt: new Date(base + 50_000).toISOString(),
    })).toEqual([]);
  });

  it("rejects a local target or non-KMS encryption for production", () => {
    const right = verifyOffsiteBackupReport({
      ...offsite(), remote: { ...offsite().remote, endpointClass: "local-smoke", encryption: "AES256" },
    }, new Date(base + 60_000));
    expect(backupEvidenceBindingBlockers({
      local: verifyBackupRestoreReport(local(), new Date(base + 60_000)), offsite: right,
      candidateBuildId: "candidate-build", deploymentManifestSha256: digest("3"), releaseCreatedAt: new Date(base + 50_000).toISOString(),
    })).toEqual(expect.arrayContaining(["PRODUCTION_RELEASE_OFFSITE_TARGET_NOT_PRODUCTION", "PRODUCTION_RELEASE_OFFSITE_KMS_REQUIRED"]));
  });

  it("rejects substituted backups, candidates and deployments", () => {
    const changed = offsite();
    changed.backup = { ...changed.backup, dumpSha256: digest("9") };
    const blockers = backupEvidenceBindingBlockers({
      local: verifyBackupRestoreReport(local(), new Date(base + 60_000)),
      offsite: verifyOffsiteBackupReport(changed, new Date(base + 60_000)),
      candidateBuildId: "other-candidate", deploymentManifestSha256: digest("8"), releaseCreatedAt: new Date(base + 50_000).toISOString(),
    });
    expect(blockers).toEqual(expect.arrayContaining([
      "PRODUCTION_RELEASE_BACKUP_CANDIDATE_MISMATCH", "PRODUCTION_RELEASE_BACKUP_DEPLOYMENT_MISMATCH", "PRODUCTION_RELEASE_BACKUP_SOURCE_MISMATCH",
    ]));
  });

  it("rejects false restore claims and impossible timestamps", () => {
    expect(() => verifyBackupRestoreReport({ ...local(), restore: { ...local().restore, coreTables: 9 } }, new Date(base + 60_000))).toThrow();
    expect(() => verifyBackupRestoreReport({ ...local(), observedAt: new Date(base + 5_000).toISOString() }, new Date(base + 60_000))).toThrow("BACKUP_EVIDENCE_TIME_ORDER_INVALID");
  });
});
