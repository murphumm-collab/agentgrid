import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/).refine((value) => !/^sha256:0{64}$/.test(value));
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const commonAssetSchema = z.object({
  secretReferenceHash: sha256Schema,
  versionHash: sha256Schema,
  kmsKeyReferenceHash: sha256Schema,
  expectedValueFingerprint: sha256Schema,
  lastChangedAt: z.string().datetime({ offset: true }),
  runtimePrincipalHashes: z.array(sha256Schema).min(1).max(6),
  leastPrivilegePolicy: z.boolean(),
  crossRegionReplicaCurrent: z.boolean(),
}).strict();

export const kmsProviderObservationSchema = z.object({
  version: z.literal(1),
  scope: z.literal("agentgrid-kms-provider-observation"),
  startedAt: z.string().datetime({ offset: true }),
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
  assets: z.tuple([
    commonAssetSchema.extend({ role: z.literal("ARTIFACT_MASTER_KEY"), expectedPublicIdentity: z.literal("none") }).strict(),
    commonAssetSchema.extend({ role: z.literal("PROTOCOL_OPERATOR_PRIVATE_KEY"), expectedPublicIdentity: addressSchema }).strict(),
    commonAssetSchema.extend({ role: z.literal("DEPLOYER_PRIVATE_KEY"), expectedPublicIdentity: addressSchema }).strict(),
    commonAssetSchema.extend({ role: z.literal("EVALUATOR_AGENT_WALLET_PRIVATE_KEY"), expectedPublicIdentity: addressSchema }).strict(),
  ]),
  recovery: z.object({
    source: z.enum(["cross-region-replica", "point-in-time-version", "offline-encrypted-escrow", "local-smoke"]),
    providerAuditEventHashes: z.array(sha256Schema).min(1).max(32),
    recoveryOperatorIdentityHash: sha256Schema,
  }).strict(),
}).strict();

export type KmsProviderObservation = z.infer<typeof kmsProviderObservationSchema>;
