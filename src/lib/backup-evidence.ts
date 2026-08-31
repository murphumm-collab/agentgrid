import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/).refine((value) => !/^sha256:0{64}$/.test(value));
const bindingSchema = {
  chainId: z.literal(97),
  candidateBuildId: z.string().min(8).max(128),
  deploymentManifestSha256: sha256Schema,
};
const backupSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  manifestSha256: sha256Schema,
  dumpSha256: sha256Schema,
  bytes: z.number().int().min(1024),
}).strict();
const restoreSchema = z.object({
  completedAt: z.string().datetime({ offset: true }),
  source: z.enum(["local", "off-host-download"]),
  checksumVerified: z.literal(true),
  coreTables: z.literal(11),
  isolatedDatabaseDropped: z.literal(true),
}).strict();

export const backupRestoreReportSchema = z.object({
  version: z.literal(1),
  scope: z.literal("agentgrid-backup-restore"),
  observedAt: z.string().datetime({ offset: true }),
  ...bindingSchema,
  backup: backupSchema,
  restore: restoreSchema.extend({ source: z.literal("local") }),
}).strict();

export const offsiteBackupReportSchema = z.object({
  version: z.literal(1),
  scope: z.literal("agentgrid-offsite-backup-restore"),
  observedAt: z.string().datetime({ offset: true }),
  ...bindingSchema,
  backup: backupSchema,
  remote: z.object({
    endpointClass: z.enum(["aws-default", "https-custom", "local-smoke"]),
    bucketHash: sha256Schema,
    objectPrefixHash: sha256Schema,
    encryption: z.enum(["AES256", "aws:kms", "none-local-smoke"]),
    contentLengthVerified: z.literal(true),
    metadataSha256Verified: z.literal(true),
    manifestBytesVerified: z.literal(true),
    dumpSha256Verified: z.literal(true),
  }).strict(),
  restore: restoreSchema.extend({ source: z.literal("off-host-download") }),
}).strict();

export type BackupRestoreReport = z.infer<typeof backupRestoreReportSchema>;
export type OffsiteBackupReport = z.infer<typeof offsiteBackupReportSchema>;

function validateReportTimes(report: { observedAt: string; backup: { createdAt: string }; restore: { completedAt: string } }, now: Date) {
  const created = new Date(report.backup.createdAt).getTime();
  const restored = new Date(report.restore.completedAt).getTime();
  const observed = new Date(report.observedAt).getTime();
  if (restored < created || observed < restored) throw new Error("BACKUP_EVIDENCE_TIME_ORDER_INVALID");
  if (observed > now.getTime() + 5 * 60_000) throw new Error("BACKUP_EVIDENCE_TIME_IN_FUTURE");
}

export function verifyBackupRestoreReport(raw: unknown, now = new Date()) {
  const report = backupRestoreReportSchema.parse(raw);
  validateReportTimes(report, now);
  return report;
}

export function verifyOffsiteBackupReport(raw: unknown, now = new Date()) {
  const report = offsiteBackupReportSchema.parse(raw);
  validateReportTimes(report, now);
  return report;
}

export function backupEvidenceBindingBlockers(input: {
  local: BackupRestoreReport;
  offsite: OffsiteBackupReport;
  candidateBuildId: string;
  deploymentManifestSha256: string;
  releaseCreatedAt: string;
}) {
  const blockers: string[] = [];
  for (const report of [input.local, input.offsite]) {
    if (report.candidateBuildId !== input.candidateBuildId) blockers.push("PRODUCTION_RELEASE_BACKUP_CANDIDATE_MISMATCH");
    if (report.deploymentManifestSha256 !== input.deploymentManifestSha256) blockers.push("PRODUCTION_RELEASE_BACKUP_DEPLOYMENT_MISMATCH");
    if (new Date(report.observedAt).getTime() > new Date(input.releaseCreatedAt).getTime()) blockers.push("PRODUCTION_RELEASE_PREDATES_BACKUP_EVIDENCE");
  }
  if (JSON.stringify(input.local.backup) !== JSON.stringify(input.offsite.backup)) blockers.push("PRODUCTION_RELEASE_BACKUP_SOURCE_MISMATCH");
  if (input.offsite.remote.endpointClass === "local-smoke") blockers.push("PRODUCTION_RELEASE_OFFSITE_TARGET_NOT_PRODUCTION");
  if (input.offsite.remote.encryption !== "aws:kms") blockers.push("PRODUCTION_RELEASE_OFFSITE_KMS_REQUIRED");
  return [...new Set(blockers)];
}
