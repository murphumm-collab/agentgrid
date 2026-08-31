import { getAddress, keccak256, recoverMessageAddress, stringToHex, type Address, type Hex } from "viem";
import { z } from "zod";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/).refine((value) => !/^sha256:0{64}$/.test(value), "zero digest is forbidden");
const relativeFileSchema = z.string().min(1).max(240).refine((value) => {
  if (value.includes("\\") || value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}, "evidence file must be a safe relative path");

export const productionReleaseRoles = ["PROTOCOL_OWNER", "SECURITY_REVIEWER", "OPERATIONS_OWNER"] as const;

const evidenceFileSchema = z.object({ file: relativeFileSchema, sha256: sha256Schema }).strict();
const releaseEvidenceFilesSchema = z.object({
  candidateReleaseManifest: evidenceFileSchema,
  deploymentManifest: evidenceFileSchema,
  pilotSignoffBundle: evidenceFileSchema,
  contractVerificationReport: evidenceFileSchema,
  applicationQaReport: evidenceFileSchema,
  backupRestoreReport: evidenceFileSchema,
  offsiteBackupReport: evidenceFileSchema,
  monitoringAlertDrillReport: evidenceFileSchema,
  tlsWafTrustedProxyReport: evidenceFileSchema,
  kmsCustodyRecoveryReport: evidenceFileSchema,
  independentSolidityAuditReport: evidenceFileSchema,
  independentWebApiAuditReport: evidenceFileSchema,
}).strict();

export const productionReleaseManifestSchema = z.object({
  version: z.literal(1),
  chainId: z.literal(97),
  releaseId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$/),
  createdAt: z.string().datetime({ offset: true }),
  candidateBuildId: z.string().min(8).max(128),
  images: z.object({ web: sha256Schema, workers: sha256Schema, ops: sha256Schema }).strict(),
  files: releaseEvidenceFilesSchema,
}).strict();

export const productionReleaseAttestationSchema = z.object({
  role: z.enum(productionReleaseRoles),
  signer: addressSchema,
  signedAt: z.string().datetime({ offset: true }),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();

export const productionReleaseBundleSchema = productionReleaseManifestSchema.extend({
  attestations: z.array(productionReleaseAttestationSchema).min(3).max(6),
}).strict();

export const productionReleaseDraftSchema = productionReleaseManifestSchema.extend({
  attestations: z.array(productionReleaseAttestationSchema.omit({ signature: true })).min(3).max(6),
}).strict();

export type ProductionReleaseManifest = z.infer<typeof productionReleaseManifestSchema>;
export type ProductionReleaseBundle = z.infer<typeof productionReleaseBundleSchema>;
export type ProductionReleaseRole = typeof productionReleaseRoles[number];
export type UnsignedProductionReleaseAttestation = Omit<z.infer<typeof productionReleaseAttestationSchema>, "signature">;

export function productionReleaseMessage(input: {
  manifest: ProductionReleaseManifest;
  attestation: UnsignedProductionReleaseAttestation;
}) {
  const manifest = productionReleaseManifestSchema.parse(input.manifest);
  const attestation = productionReleaseAttestationSchema.omit({ signature: true }).parse(input.attestation);
  const normalizedAttestation = {
    role: attestation.role,
    signer: getAddress(attestation.signer),
    signedAt: new Date(attestation.signedAt).toISOString(),
  };
  const manifestHash = keccak256(stringToHex(JSON.stringify(manifest)));
  const attestationHash = keccak256(stringToHex(JSON.stringify(normalizedAttestation)));
  return {
    manifest,
    manifestHash,
    attestation: normalizedAttestation,
    attestationHash,
    message: `AgentGrid Production Release\nVersion: 1\nChain ID: 97\nRelease: ${manifest.releaseId}\nManifest: ${manifestHash}\nRole: ${normalizedAttestation.role}\nAttestation: ${attestationHash}`,
  };
}

export interface VerifiedProductionReleaseBundle {
  manifest: ProductionReleaseManifest;
  manifestHash: Hex;
  attestations: Array<{ role: ProductionReleaseRole; signer: Address; signedAt: string; attestationHash: Hex }>;
}

export async function verifyProductionReleaseBundle(raw: unknown, now = new Date()): Promise<VerifiedProductionReleaseBundle> {
  const bundle = productionReleaseBundleSchema.parse(raw);
  const { attestations, ...manifestInput } = bundle;
  const manifest = productionReleaseManifestSchema.parse(manifestInput);
  const createdAt = new Date(manifest.createdAt).getTime();
  if (createdAt > now.getTime() + 5 * 60_000) throw new Error("PRODUCTION_RELEASE_TIME_IN_FUTURE");
  const seenRoles = new Set<ProductionReleaseRole>();
  const seenSigners = new Set<string>();
  const verified: VerifiedProductionReleaseBundle["attestations"] = [];
  let manifestHash: Hex | undefined;
  for (const item of attestations) {
    const { signature, ...unsigned } = item;
    const commitment = productionReleaseMessage({ manifest, attestation: unsigned });
    manifestHash ??= commitment.manifestHash;
    if (seenRoles.has(item.role)) throw new Error("PRODUCTION_RELEASE_ROLE_DUPLICATE");
    seenRoles.add(item.role);
    const signer = commitment.attestation.signer.toLowerCase();
    if (seenSigners.has(signer)) throw new Error("PRODUCTION_RELEASE_SIGNER_ROLE_CONFLICT");
    seenSigners.add(signer);
    const signedAt = new Date(commitment.attestation.signedAt).getTime();
    if (signedAt < createdAt) throw new Error("PRODUCTION_RELEASE_SIGNATURE_PREDATES_MANIFEST");
    if (signedAt > now.getTime() + 5 * 60_000) throw new Error("PRODUCTION_RELEASE_SIGNATURE_IN_FUTURE");
    const recovered = await recoverMessageAddress({ message: commitment.message, signature: signature as Hex });
    if (recovered.toLowerCase() !== signer) throw new Error("PRODUCTION_RELEASE_SIGNATURE_INVALID");
    verified.push({ ...commitment.attestation, attestationHash: commitment.attestationHash });
  }
  for (const role of productionReleaseRoles) if (!seenRoles.has(role)) throw new Error(`PRODUCTION_RELEASE_${role}_REQUIRED`);
  return { manifest, manifestHash: manifestHash!, attestations: verified };
}
