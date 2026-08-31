import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/).refine((value) => !/^sha256:0{64}$/.test(value));
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const custodyAssetRoles = [
  "ARTIFACT_MASTER_KEY", "PROTOCOL_OPERATOR_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY", "EVALUATOR_AGENT_WALLET_PRIVATE_KEY",
] as const;

const commonAssetSchema = z.object({
  secretReferenceHash: sha256Schema,
  versionHash: sha256Schema,
  kmsKeyReferenceHash: sha256Schema,
  valueFingerprint: sha256Schema,
  lastChangedAt: z.string().datetime({ offset: true }),
  runtimePrincipalHashes: z.array(sha256Schema).min(1).max(6),
  leastPrivilegePolicy: z.boolean(),
  crossRegionReplicaCurrent: z.boolean(),
}).strict();

const artifactAssetSchema = commonAssetSchema.extend({
  role: z.literal("ARTIFACT_MASTER_KEY"),
  publicIdentity: z.literal("none"),
}).strict();
const operatorAssetSchema = commonAssetSchema.extend({
  role: z.literal("PROTOCOL_OPERATOR_PRIVATE_KEY"),
  publicIdentity: addressSchema,
}).strict();
const deployerAssetSchema = commonAssetSchema.extend({
  role: z.literal("DEPLOYER_PRIVATE_KEY"),
  publicIdentity: addressSchema,
}).strict();
const evaluatorAssetSchema = commonAssetSchema.extend({
  role: z.literal("EVALUATOR_AGENT_WALLET_PRIVATE_KEY"),
  publicIdentity: addressSchema,
}).strict();

export const kmsCustodyReportSchema = z.object({
  version: z.literal(1),
  scope: z.literal("agentgrid-kms-custody-recovery"),
  chainId: z.literal(97),
  candidateBuildId: z.string().min(8).max(128),
  deploymentManifestSha256: sha256Schema,
  startedAt: z.string().datetime({ offset: true }),
  observedAt: z.string().datetime({ offset: true }),
  custody: z.object({
    targetClass: z.enum(["production-kms", "local-smoke"]),
    provider: z.enum(["aws-secrets-manager-kms", "gcp-secret-manager-kms", "azure-key-vault", "hashicorp-vault", "local-smoke"]),
    primaryRegionHash: sha256Schema,
    recoveryRegionHash: sha256Schema,
    workloadIdentity: z.boolean(),
    longLivedCloudCredentialAbsent: z.boolean(),
    customerManagedEncryptionKey: z.boolean(),
    keyRotationEnabled: z.boolean(),
    auditLoggingEnabled: z.boolean(),
    deletionProtectionEnabled: z.boolean(),
    recoveryWindowDays: z.number().int().min(0).max(365),
    accessPolicySha256: sha256Schema,
    auditExportSha256: sha256Schema,
  }).strict(),
  assets: z.tuple([artifactAssetSchema, operatorAssetSchema, deployerAssetSchema, evaluatorAssetSchema]),
  recovery: z.object({
    source: z.enum(["cross-region-replica", "point-in-time-version", "offline-encrypted-escrow", "local-smoke"]),
    completedAt: z.string().datetime({ offset: true }),
    isolatedEphemeralJob: z.boolean(),
    originalRuntimeDisabled: z.boolean(),
    secretFilesMode400: z.boolean(),
    valuesNotLogged: z.boolean(),
    reportOutsideSecretMount: z.boolean(),
    allAssetFingerprintsMatched: z.boolean(),
    artifactEnvelopeRoundTrip: z.boolean(),
    walletSignatureRoundTrips: z.number().int().min(0).max(3),
    ephemeralMountsScopedToJob: z.boolean(),
    providerAuditEventHashes: z.array(sha256Schema).min(1).max(32),
    recoveryOperatorIdentityHash: sha256Schema,
  }).strict(),
}).strict();

export type KmsCustodyReport = z.infer<typeof kmsCustodyReportSchema>;

export function verifyKmsCustodyReport(raw: unknown, now = new Date()) {
  const report = kmsCustodyReportSchema.parse(raw);
  const startedAt = new Date(report.startedAt).getTime();
  const completedAt = new Date(report.recovery.completedAt).getTime();
  const observedAt = new Date(report.observedAt).getTime();
  if (completedAt < startedAt || observedAt < completedAt || observedAt > now.getTime() + 5 * 60_000) {
    throw new Error("KMS_EVIDENCE_TIME_INVALID");
  }
  for (const asset of report.assets) {
    if (new Date(asset.lastChangedAt).getTime() > startedAt) throw new Error("KMS_EVIDENCE_ASSET_VERSION_CHANGED_DURING_RECOVERY");
    if (new Set(asset.runtimePrincipalHashes).size !== asset.runtimePrincipalHashes.length) throw new Error("KMS_EVIDENCE_PRINCIPAL_DUPLICATE");
  }
  const walletAddresses = report.assets.slice(1).map((asset) => asset.publicIdentity.toLowerCase());
  if (new Set(walletAddresses).size !== walletAddresses.length) throw new Error("KMS_EVIDENCE_WALLET_IDENTITY_REUSED");
  if (new Set(report.recovery.providerAuditEventHashes).size !== report.recovery.providerAuditEventHashes.length) {
    throw new Error("KMS_EVIDENCE_AUDIT_EVENT_DUPLICATE");
  }
  return report;
}

export function kmsCustodyBindingBlockers(input: {
  report: KmsCustodyReport;
  candidateBuildId: string;
  candidateCreatedAt: string;
  deploymentManifestSha256: string;
  releaseCreatedAt: string;
}) {
  const blockers: string[] = [];
  const report = input.report;
  const observedAt = new Date(report.observedAt).getTime();
  const releaseAt = new Date(input.releaseCreatedAt).getTime();
  if (report.candidateBuildId !== input.candidateBuildId) blockers.push("PRODUCTION_RELEASE_KMS_CANDIDATE_MISMATCH");
  if (report.deploymentManifestSha256 !== input.deploymentManifestSha256) blockers.push("PRODUCTION_RELEASE_KMS_DEPLOYMENT_MISMATCH");
  if (new Date(report.startedAt).getTime() < new Date(input.candidateCreatedAt).getTime()) blockers.push("PRODUCTION_RELEASE_KMS_PREDATES_CANDIDATE");
  if (observedAt > releaseAt) blockers.push("PRODUCTION_RELEASE_PREDATES_KMS_EVIDENCE");
  if (releaseAt - observedAt > 7 * 86_400_000) blockers.push("PRODUCTION_RELEASE_KMS_EVIDENCE_STALE");
  const custody = report.custody;
  if (custody.targetClass !== "production-kms" || custody.provider === "local-smoke") blockers.push("PRODUCTION_RELEASE_KMS_TARGET_NOT_PRODUCTION");
  if (!custody.workloadIdentity || !custody.longLivedCloudCredentialAbsent || !custody.customerManagedEncryptionKey
    || !custody.keyRotationEnabled || !custody.auditLoggingEnabled || !custody.deletionProtectionEnabled
    || custody.recoveryWindowDays < 7 || custody.primaryRegionHash === custody.recoveryRegionHash) {
    blockers.push("PRODUCTION_RELEASE_KMS_CUSTODY_CONTROLS_INCOMPLETE");
  }
  if (report.assets.some((asset) => !asset.leastPrivilegePolicy || !asset.crossRegionReplicaCurrent)) {
    blockers.push("PRODUCTION_RELEASE_KMS_ASSET_POLICY_INCOMPLETE");
  }
  const recovery = report.recovery;
  if (recovery.source === "local-smoke" || !recovery.isolatedEphemeralJob || !recovery.originalRuntimeDisabled
    || !recovery.secretFilesMode400 || !recovery.valuesNotLogged || !recovery.reportOutsideSecretMount
    || !recovery.allAssetFingerprintsMatched || !recovery.artifactEnvelopeRoundTrip
    || recovery.walletSignatureRoundTrips !== 3 || !recovery.ephemeralMountsScopedToJob
    || recovery.providerAuditEventHashes.length < 4) {
    blockers.push("PRODUCTION_RELEASE_KMS_RECOVERY_UNPROVEN");
  }
  return [...new Set(blockers)];
}
