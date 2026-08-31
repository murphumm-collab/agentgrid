import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { kmsCustodyBindingBlockers, verifyKmsCustodyReport } from "../src/lib/kms-custody-evidence";
import { kmsProviderObservationSchema } from "../src/lib/kms-provider-observation";
import { custodyValueFingerprint, runKmsCustodyVerification } from "./kms-custody-verify";

const filenames = {
  ARTIFACT_MASTER_KEY: "artifact_master_key",
  PROTOCOL_OPERATOR_PRIVATE_KEY: "protocol_operator_private_key",
  DEPLOYER_PRIVATE_KEY: "deployer_private_key",
  EVALUATOR_AGENT_WALLET_PRIVATE_KEY: "evaluator_agent_wallet_private_key",
} as const;

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

async function main() {
  const folder = await fs.mkdtemp(path.join(tmpdir(), "agentgrid-kms-smoke-"));
  const secretRoot = path.join(folder, "recovered-secrets");
  await fs.mkdir(secretRoot, { mode: 0o700 });
  await fs.chmod(secretRoot, 0o700);
  const values = {
    ARTIFACT_MASTER_KEY: randomBytes(32).toString("hex"),
    PROTOCOL_OPERATOR_PRIVATE_KEY: generatePrivateKey(),
    DEPLOYER_PRIVATE_KEY: generatePrivateKey(),
    EVALUATOR_AGENT_WALLET_PRIVATE_KEY: generatePrivateKey(),
  } as const;
  for (const [role, filename] of Object.entries(filenames) as Array<[keyof typeof filenames, string]>) {
    const output = path.join(secretRoot, filename);
    await fs.writeFile(output, `${values[role]}\n`, { mode: 0o400, flag: "wx" });
    await fs.chmod(output, 0o400);
  }

  const startedAt = new Date();
  const lastChangedAt = new Date(startedAt.getTime() - 60_000).toISOString();
  const candidateBuildId = "local-kms-recovery-smoke";
  const deploymentManifestSha256 = sha256("local-kms-recovery-deployment");
  const accountFor = (role: "PROTOCOL_OPERATOR_PRIVATE_KEY" | "DEPLOYER_PRIVATE_KEY" | "EVALUATOR_AGENT_WALLET_PRIVATE_KEY") => (
    privateKeyToAccount(values[role]).address
  );
  const common = (role: keyof typeof filenames, index: number) => ({
    secretReferenceHash: sha256(`local-secret-reference-${index}`),
    versionHash: sha256(`local-secret-version-${index}`),
    kmsKeyReferenceHash: sha256(`local-kms-key-${index}`),
    expectedValueFingerprint: custodyValueFingerprint(role, values[role]),
    lastChangedAt,
    runtimePrincipalHashes: [sha256(`local-runtime-principal-${index}`)],
    leastPrivilegePolicy: false,
    crossRegionReplicaCurrent: false,
  });
  const observation = kmsProviderObservationSchema.parse({
    version: 1,
    scope: "agentgrid-kms-provider-observation",
    startedAt: startedAt.toISOString(),
    custody: {
      targetClass: "local-smoke",
      provider: "local-smoke",
      primaryRegionHash: sha256("local-region"),
      recoveryRegionHash: sha256("local-region"),
      workloadIdentity: false,
      longLivedCloudCredentialAbsent: false,
      customerManagedEncryptionKey: false,
      keyRotationEnabled: false,
      auditLoggingEnabled: false,
      deletionProtectionEnabled: false,
      recoveryWindowDays: 0,
      accessPolicySha256: sha256("local-access-policy"),
      auditExportSha256: sha256("local-audit-export"),
    },
    assets: [
      { role: "ARTIFACT_MASTER_KEY", expectedPublicIdentity: "none", ...common("ARTIFACT_MASTER_KEY", 1) },
      { role: "PROTOCOL_OPERATOR_PRIVATE_KEY", expectedPublicIdentity: accountFor("PROTOCOL_OPERATOR_PRIVATE_KEY"), ...common("PROTOCOL_OPERATOR_PRIVATE_KEY", 2) },
      { role: "DEPLOYER_PRIVATE_KEY", expectedPublicIdentity: accountFor("DEPLOYER_PRIVATE_KEY"), ...common("DEPLOYER_PRIVATE_KEY", 3) },
      { role: "EVALUATOR_AGENT_WALLET_PRIVATE_KEY", expectedPublicIdentity: accountFor("EVALUATOR_AGENT_WALLET_PRIVATE_KEY"), ...common("EVALUATOR_AGENT_WALLET_PRIVATE_KEY", 4) },
    ],
    recovery: {
      source: "local-smoke",
      providerAuditEventHashes: [1, 2, 3, 4].map((index) => sha256(`local-audit-event-${index}`)),
      recoveryOperatorIdentityHash: sha256("local-recovery-operator"),
    },
  });
  const configuredReport = process.env.KMS_CUSTODY_SMOKE_REPORT_FILE?.trim();
  const reportFile = configuredReport ? path.resolve(configuredReport) : path.join(folder, "kms-custody-recovery.json");
  try {
    const linkedRoot = path.join(folder, "linked-recovered-secrets");
    await fs.symlink(secretRoot, linkedRoot, "dir");
    await runKmsCustodyVerification({
      observation, secretRoot: linkedRoot, candidateBuildId, deploymentManifestSha256,
      reportFile: path.join(folder, "must-not-exist-symlink.json"), isolatedEphemeralJob: true,
      originalRuntimeDisabled: true, ephemeralMountsScopedToJob: true,
    }).then(
      () => { throw new Error("KMS_SMOKE_SYMLINK_ROOT_ACCEPTED"); },
      (error: unknown) => {
        if (!(error instanceof Error) || error.message !== "KMS_RECOVERY_SECRET_ROOT_INVALID") throw error;
      },
    );
    await runKmsCustodyVerification({
      observation, secretRoot, candidateBuildId, deploymentManifestSha256,
      reportFile: path.join(secretRoot, "must-not-exist-report.json"), isolatedEphemeralJob: true,
      originalRuntimeDisabled: true, ephemeralMountsScopedToJob: true,
    }).then(
      () => { throw new Error("KMS_SMOKE_SECRET_MOUNT_REPORT_ACCEPTED"); },
      (error: unknown) => {
        if (!(error instanceof Error) || error.message !== "KMS_REPORT_INSIDE_SECRET_MOUNT") throw error;
      },
    );
    const result = await runKmsCustodyVerification({
      observation,
      secretRoot,
      candidateBuildId,
      deploymentManifestSha256,
      reportFile,
      isolatedEphemeralJob: true,
      originalRuntimeDisabled: true,
      ephemeralMountsScopedToJob: true,
    });
    const rawReport = await fs.readFile(reportFile, "utf8");
    for (const secret of Object.values(values)) {
      if (rawReport.includes(secret)) throw new Error("KMS_SMOKE_SECRET_DISCLOSED_IN_REPORT");
    }
    const report = verifyKmsCustodyReport(JSON.parse(rawReport));
    const blockers = kmsCustodyBindingBlockers({
      report,
      candidateBuildId,
      candidateCreatedAt: report.startedAt,
      deploymentManifestSha256,
      releaseCreatedAt: report.observedAt,
    });
    const expectedBlockers = [
      "PRODUCTION_RELEASE_KMS_TARGET_NOT_PRODUCTION",
      "PRODUCTION_RELEASE_KMS_CUSTODY_CONTROLS_INCOMPLETE",
      "PRODUCTION_RELEASE_KMS_ASSET_POLICY_INCOMPLETE",
      "PRODUCTION_RELEASE_KMS_RECOVERY_UNPROVEN",
    ];
    if (expectedBlockers.some((blocker) => !blockers.includes(blocker)) || blockers.length !== expectedBlockers.length) {
      throw new Error("KMS_SMOKE_PRODUCTION_GATE_INVALID");
    }
    const stat = await fs.stat(reportFile);
    if ((stat.mode & 0o777) !== 0o600) throw new Error("KMS_SMOKE_REPORT_MODE_INVALID");
    console.log(JSON.stringify({
      kmsCustodySmoke: true,
      recoveredAssets: result.report.assets.length,
      walletSignatureRoundTrips: result.report.recovery.walletSignatureRoundTrips,
      artifactEnvelopeRoundTrip: result.report.recovery.artifactEnvelopeRoundTrip,
      symlinkSecretRootRejected: true,
      reportInsideSecretMountRejected: true,
      reportMode: "600",
      productionEligible: false,
      productionBlockers: blockers,
      output: configuredReport ? result.output : null,
    }));
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : "KMS_CUSTODY_SMOKE_FAILED");
  process.exitCode = 1;
});
