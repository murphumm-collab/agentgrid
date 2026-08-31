import { getAddress, keccak256, recoverMessageAddress, stringToHex, type Address, type Hex } from "viem";
import { z } from "zod";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const taskIdsSchema = z.array(z.string().regex(/^(0|[1-9][0-9]*)$/)).min(3).max(64);

export const pilotSignoffRoles = [
  "PUBLISHER_INDEPENDENCE_REVIEW",
  "AGENT_INDEPENDENCE_REVIEW",
  "SUPPORT_OWNER",
  "DISPUTE_OWNER",
  "INCIDENT_RESPONSE_OWNER",
  "ROLLBACK_OWNER",
] as const;

export const pilotSignoffAttestationSchema = z.object({
  role: z.enum(pilotSignoffRoles),
  signer: addressSchema,
  subjectAddresses: z.array(addressSchema).max(64),
  evidenceHash: sha256Schema,
  signedAt: z.string().datetime({ offset: true }),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();

export const pilotSignoffBundleSchema = z.object({
  version: z.literal(1),
  chainId: z.literal(97),
  pilotId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/),
  deploymentManifestSha256: sha256Schema,
  taskIds: taskIdsSchema,
  attestations: z.array(pilotSignoffAttestationSchema).min(6).max(24),
}).strict();

export const pilotSignoffDraftSchema = pilotSignoffBundleSchema.extend({
  attestations: z.array(pilotSignoffAttestationSchema.omit({ signature: true })).min(6).max(24),
}).strict();

export type PilotSignoffRole = typeof pilotSignoffRoles[number];
export type PilotSignoffAttestation = z.infer<typeof pilotSignoffAttestationSchema>;
export type PilotSignoffBundle = z.infer<typeof pilotSignoffBundleSchema>;
export type PilotSignoffDraft = z.infer<typeof pilotSignoffDraftSchema>;

export type UnsignedPilotSignoff = Omit<PilotSignoffAttestation, "signature">;

function normalizedAddresses(values: readonly string[]) {
  const addresses = values.map((value) => getAddress(value)).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) throw new Error("PILOT_SIGNOFF_SUBJECT_DUPLICATE");
  return addresses;
}

function normalizedTaskIds(values: readonly string[]) {
  const taskIds = [...values].sort((left, right) => {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  if (new Set(taskIds).size !== taskIds.length) throw new Error("PILOT_SIGNOFF_TASK_DUPLICATE");
  return taskIds;
}

export function pilotSignoffMessage(input: {
  pilotId: string;
  deploymentManifestSha256: string;
  taskIds: string[];
  attestation: UnsignedPilotSignoff;
}) {
  const parsed = pilotSignoffBundleSchema.pick({ pilotId: true, deploymentManifestSha256: true, taskIds: true }).extend({
    attestation: pilotSignoffAttestationSchema.omit({ signature: true }),
  }).parse(input);
  const taskIds = normalizedTaskIds(parsed.taskIds);
  const taskSetHash = keccak256(stringToHex(JSON.stringify(taskIds)));
  const normalized = {
    role: parsed.attestation.role,
    signer: getAddress(parsed.attestation.signer),
    subjectAddresses: normalizedAddresses(parsed.attestation.subjectAddresses),
    evidenceHash: parsed.attestation.evidenceHash,
    signedAt: new Date(parsed.attestation.signedAt).toISOString(),
  };
  const attestationHash = keccak256(stringToHex(JSON.stringify(normalized)));
  return {
    attestation: normalized,
    attestationHash,
    taskIds,
    taskSetHash,
    message: `AgentGrid Pilot Sign-off\nVersion: 1\nChain ID: 97\nPilot: ${parsed.pilotId}\nDeployment: ${parsed.deploymentManifestSha256}\nTasks: ${taskSetHash}\nRole: ${normalized.role}\nAttestation: ${attestationHash}`,
  };
}

export interface VerifiedPilotSignoffBundle {
  pilotId: string;
  deploymentManifestSha256: string;
  taskIds: string[];
  taskSetHash: Hex;
  attestations: Array<{
    role: PilotSignoffRole;
    signer: Address;
    subjectAddresses: Address[];
    evidenceHash: string;
    signedAt: string;
    attestationHash: Hex;
  }>;
}

export async function verifyPilotSignoffBundle(raw: unknown, now = new Date()): Promise<VerifiedPilotSignoffBundle> {
  const bundle = pilotSignoffBundleSchema.parse(raw);
  const taskIds = normalizedTaskIds(bundle.taskIds);
  const taskSetHash = keccak256(stringToHex(JSON.stringify(taskIds)));
  const seen = new Set<string>();
  const signerRoles = new Map<string, PilotSignoffRole>();
  const verified: VerifiedPilotSignoffBundle["attestations"] = [];
  for (const item of bundle.attestations) {
    const { signature, ...unsigned } = item;
    const commitment = pilotSignoffMessage({
      pilotId: bundle.pilotId,
      deploymentManifestSha256: bundle.deploymentManifestSha256,
      taskIds,
      attestation: unsigned,
    });
    const key = `${item.role}:${commitment.attestation.signer.toLowerCase()}`;
    if (seen.has(key)) throw new Error("PILOT_SIGNOFF_DUPLICATE_ROLE_SIGNER");
    seen.add(key);
    const signerKey = commitment.attestation.signer.toLowerCase();
    if (signerRoles.has(signerKey) && signerRoles.get(signerKey) !== item.role) throw new Error("PILOT_SIGNOFF_SIGNER_ROLE_CONFLICT");
    signerRoles.set(signerKey, item.role);
    if (new Date(commitment.attestation.signedAt).getTime() > now.getTime() + 5 * 60 * 1_000) throw new Error("PILOT_SIGNOFF_TIME_IN_FUTURE");
    if (item.role.endsWith("INDEPENDENCE_REVIEW") && commitment.attestation.subjectAddresses.length < 3) {
      throw new Error("PILOT_SIGNOFF_INDEPENDENCE_SUBJECTS_INSUFFICIENT");
    }
    if (item.role.endsWith("INDEPENDENCE_REVIEW")
      && commitment.attestation.subjectAddresses.some((address) => address.toLowerCase() === commitment.attestation.signer.toLowerCase())) {
      throw new Error("PILOT_SIGNOFF_REVIEWER_CONFLICT");
    }
    const recovered = await recoverMessageAddress({ message: commitment.message, signature: signature as Hex });
    if (recovered.toLowerCase() !== commitment.attestation.signer.toLowerCase()) throw new Error("PILOT_SIGNOFF_SIGNATURE_INVALID");
    verified.push({ ...commitment.attestation, attestationHash: commitment.attestationHash });
  }
  return { pilotId: bundle.pilotId, deploymentManifestSha256: bundle.deploymentManifestSha256, taskIds, taskSetHash, attestations: verified };
}
