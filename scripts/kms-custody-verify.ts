import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { getAddress, recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { writeNewEvidenceFile } from "../src/lib/evidence-file";
import { kmsCustodyBindingBlockers, kmsCustodyReportSchema } from "../src/lib/kms-custody-evidence";
import { kmsProviderObservationSchema, type KmsProviderObservation } from "../src/lib/kms-provider-observation";

const secretFilenames = {
  ARTIFACT_MASTER_KEY: "artifact_master_key",
  PROTOCOL_OPERATOR_PRIVATE_KEY: "protocol_operator_private_key",
  DEPLOYER_PRIVATE_KEY: "deployer_private_key",
  EVALUATOR_AGENT_WALLET_PRIVATE_KEY: "evaluator_agent_wallet_private_key",
} as const;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function custodyValueFingerprint(role: keyof typeof secretFilenames, value: string) {
  return sha256(`${role}\0${value}`);
}

async function boundedJson(filename: string) {
  const handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) throw new Error("KMS_OBSERVATION_FILE_SIZE_INVALID");
    if ((stat.mode & 0o022) !== 0) throw new Error("KMS_OBSERVATION_FILE_WRITABLE_BY_OTHERS");
    return JSON.parse((await handle.readFile()).toString("utf8")) as unknown;
  } finally { await handle.close(); }
}

async function secretFile(filename: string) {
  const handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 64 * 1024) throw new Error("KMS_RECOVERY_SECRET_FILE_SIZE_INVALID");
    if ((stat.mode & 0o777) !== 0o400) throw new Error("KMS_RECOVERY_SECRET_FILE_MODE_INVALID");
    const raw = (await handle.readFile()).toString("utf8");
    if (raw.includes("\0")) throw new Error("KMS_RECOVERY_SECRET_FILE_NUL_FORBIDDEN");
    const value = raw.replace(/\r?\n$/, "");
    if (!value || value.includes("\n") || value.includes("\r")) throw new Error("KMS_RECOVERY_SECRET_FILE_VALUE_INVALID");
    return value;
  } finally { await handle.close(); }
}

function artifactRoundTrip(keyHex: string) {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("KMS_RECOVERY_ARTIFACT_MASTER_KEY_INVALID");
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const plaintext = randomBytes(32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(cipher.getAuthTag());
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).equals(plaintext);
}

async function walletRoundTrip(privateKey: string, message: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("KMS_RECOVERY_WALLET_PRIVATE_KEY_INVALID");
  const account = privateKeyToAccount(privateKey as Hex);
  const signature = await account.signMessage({ message });
  const recovered = await recoverMessageAddress({ message, signature });
  if (recovered.toLowerCase() !== account.address.toLowerCase()) throw new Error("KMS_RECOVERY_WALLET_SIGNATURE_INVALID");
  return getAddress(account.address);
}

export async function runKmsCustodyVerification(input: {
  observation: KmsProviderObservation;
  secretRoot: string;
  candidateBuildId: string;
  deploymentManifestSha256: string;
  reportFile: string;
  isolatedEphemeralJob: boolean;
  originalRuntimeDisabled: boolean;
  ephemeralMountsScopedToJob: boolean;
}) {
  const observation = kmsProviderObservationSchema.parse(input.observation);
  const requestedRoot = path.resolve(input.secretRoot);
  const requestedRootStat = await fs.lstat(requestedRoot);
  if (requestedRootStat.isSymbolicLink()) throw new Error("KMS_RECOVERY_SECRET_ROOT_INVALID");
  const root = await fs.realpath(requestedRoot);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o077) !== 0) throw new Error("KMS_RECOVERY_SECRET_ROOT_INVALID");
  const requestedOutput = path.resolve(input.reportFile);
  const outputParent = await fs.realpath(path.dirname(requestedOutput));
  const output = path.join(outputParent, path.basename(requestedOutput));
  if (output === root || output.startsWith(`${root}${path.sep}`)) throw new Error("KMS_REPORT_INSIDE_SECRET_MOUNT");
  const values = {} as Record<keyof typeof secretFilenames, string>;
  for (const [role, filename] of Object.entries(secretFilenames) as Array<[keyof typeof secretFilenames, string]>) {
    values[role] = await secretFile(path.join(root, filename));
  }
  const fingerprintsMatch = observation.assets.every((asset) => (
    custodyValueFingerprint(asset.role, values[asset.role]) === asset.expectedValueFingerprint
  ));
  if (!fingerprintsMatch) throw new Error("KMS_RECOVERY_FINGERPRINT_MISMATCH");
  const challenge = `AgentGrid KMS Recovery Drill\nChain ID: 97\nCandidate: ${input.candidateBuildId}\nDeployment: ${input.deploymentManifestSha256}\nChallenge: ${sha256(randomBytes(32))}`;
  const walletAddresses = await Promise.all([
    walletRoundTrip(values.PROTOCOL_OPERATOR_PRIVATE_KEY, challenge),
    walletRoundTrip(values.DEPLOYER_PRIVATE_KEY, challenge),
    walletRoundTrip(values.EVALUATOR_AGENT_WALLET_PRIVATE_KEY, challenge),
  ]);
  for (let index = 1; index < observation.assets.length; index += 1) {
    if (walletAddresses[index - 1]!.toLowerCase() !== observation.assets[index]!.expectedPublicIdentity.toLowerCase()) {
      throw new Error("KMS_RECOVERY_PUBLIC_IDENTITY_MISMATCH");
    }
  }
  const artifactEnvelopeRoundTrip = artifactRoundTrip(values.ARTIFACT_MASTER_KEY);
  if (!artifactEnvelopeRoundTrip) throw new Error("KMS_RECOVERY_ARTIFACT_ROUNDTRIP_FAILED");
  const completedAt = new Date().toISOString();
  const report = kmsCustodyReportSchema.parse({
    version: 1,
    scope: "agentgrid-kms-custody-recovery",
    chainId: 97,
    candidateBuildId: input.candidateBuildId,
    deploymentManifestSha256: input.deploymentManifestSha256,
    startedAt: observation.startedAt,
    observedAt: completedAt,
    custody: observation.custody,
    assets: observation.assets.map((asset, index) => ({
      role: asset.role,
      publicIdentity: index === 0 ? "none" : walletAddresses[index - 1],
      secretReferenceHash: asset.secretReferenceHash,
      versionHash: asset.versionHash,
      kmsKeyReferenceHash: asset.kmsKeyReferenceHash,
      valueFingerprint: asset.expectedValueFingerprint,
      lastChangedAt: asset.lastChangedAt,
      runtimePrincipalHashes: asset.runtimePrincipalHashes,
      leastPrivilegePolicy: asset.leastPrivilegePolicy,
      crossRegionReplicaCurrent: asset.crossRegionReplicaCurrent,
    })),
    recovery: {
      source: observation.recovery.source,
      completedAt,
      isolatedEphemeralJob: input.isolatedEphemeralJob,
      originalRuntimeDisabled: input.originalRuntimeDisabled,
      secretFilesMode400: true,
      valuesNotLogged: true,
      reportOutsideSecretMount: true,
      allAssetFingerprintsMatched: true,
      artifactEnvelopeRoundTrip,
      walletSignatureRoundTrips: 3,
      ephemeralMountsScopedToJob: input.ephemeralMountsScopedToJob,
      providerAuditEventHashes: observation.recovery.providerAuditEventHashes,
      recoveryOperatorIdentityHash: observation.recovery.recoveryOperatorIdentityHash,
    },
  });
  if (observation.custody.targetClass === "production-kms") {
    const blockers = kmsCustodyBindingBlockers({
      report,
      candidateBuildId: report.candidateBuildId,
      candidateCreatedAt: report.startedAt,
      deploymentManifestSha256: report.deploymentManifestSha256,
      releaseCreatedAt: report.observedAt,
    });
    if (blockers.length) throw new Error(blockers[0]);
  }
  const reportOutput = await writeNewEvidenceFile(output, report, "KMS_EVIDENCE");
  return { report, output: reportOutput };
}

async function main() {
  const observation = kmsProviderObservationSchema.parse(await boundedJson(required("KMS_PROVIDER_OBSERVATION_FILE")));
  const result = await runKmsCustodyVerification({
    observation,
    secretRoot: required("KMS_RECOVERY_SECRET_ROOT"),
    candidateBuildId: required("KMS_EVIDENCE_CANDIDATE_BUILD_ID"),
    deploymentManifestSha256: required("KMS_EVIDENCE_DEPLOYMENT_MANIFEST_SHA256"),
    reportFile: required("KMS_CUSTODY_REPORT_FILE"),
    isolatedEphemeralJob: process.env.KMS_RECOVERY_EPHEMERAL_JOB === "true",
    originalRuntimeDisabled: process.env.KMS_RECOVERY_ORIGINAL_RUNTIME_DISABLED === "true",
    ephemeralMountsScopedToJob: process.env.KMS_RECOVERY_MOUNTS_SCOPED_TO_JOB === "true",
  });
  console.log(JSON.stringify({
    kmsCustodyVerified: observation.custody.targetClass === "production-kms",
    targetClass: observation.custody.targetClass,
    recoveredAssets: result.report.assets.length,
    output: result.output,
  }));
}

if (process.argv[1]?.endsWith("kms-custody-verify.ts") || process.argv[1]?.endsWith("kmsVerify.js")) {
  void main().catch((error) => {
    console.error(error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : "KMS_CUSTODY_VERIFY_FAILED");
    process.exitCode = 1;
  });
}
