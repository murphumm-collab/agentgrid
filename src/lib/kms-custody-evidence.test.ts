import { describe, expect, it } from "vitest";
import { kmsCustodyBindingBlockers, verifyKmsCustodyReport, type KmsCustodyReport } from "./kms-custody-evidence";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const addresses = ["1", "2", "3"].map((value) => `0x${value.repeat(40)}`);
const afterFixture = new Date("2026-08-31T00:02:00.000Z");

function fixture(): KmsCustodyReport {
  const common = (offset: number) => ({
    secretReferenceHash: hash(String(offset)), versionHash: hash(String(offset + 1)), kmsKeyReferenceHash: hash("a"),
    valueFingerprint: hash(String(offset + 2)), lastChangedAt: "2026-08-30T00:00:00.000Z",
    runtimePrincipalHashes: [hash(String(offset + 3))], leastPrivilegePolicy: true, crossRegionReplicaCurrent: true,
  });
  return {
    version: 1, scope: "agentgrid-kms-custody-recovery", chainId: 97,
    candidateBuildId: "candidate-build-123", deploymentManifestSha256: hash("b"),
    startedAt: "2026-08-31T00:00:00.000Z", observedAt: "2026-08-31T00:01:00.000Z",
    custody: {
      targetClass: "production-kms", provider: "aws-secrets-manager-kms", primaryRegionHash: hash("c"), recoveryRegionHash: hash("d"),
      workloadIdentity: true, longLivedCloudCredentialAbsent: true, customerManagedEncryptionKey: true,
      keyRotationEnabled: true, auditLoggingEnabled: true, deletionProtectionEnabled: true, recoveryWindowDays: 30,
      accessPolicySha256: hash("e"), auditExportSha256: hash("f"),
    },
    assets: [
      { role: "ARTIFACT_MASTER_KEY", publicIdentity: "none", ...common(1) },
      { role: "PROTOCOL_OPERATOR_PRIVATE_KEY", publicIdentity: addresses[0]!, ...common(2) },
      { role: "DEPLOYER_PRIVATE_KEY", publicIdentity: addresses[1]!, ...common(3) },
      { role: "EVALUATOR_AGENT_WALLET_PRIVATE_KEY", publicIdentity: addresses[2]!, ...common(4) },
    ],
    recovery: {
      source: "cross-region-replica", completedAt: "2026-08-31T00:00:59.000Z", isolatedEphemeralJob: true,
      originalRuntimeDisabled: true, secretFilesMode400: true, valuesNotLogged: true, reportOutsideSecretMount: true,
      allAssetFingerprintsMatched: true, artifactEnvelopeRoundTrip: true, walletSignatureRoundTrips: 3,
      ephemeralMountsScopedToJob: true, providerAuditEventHashes: [hash("1"), hash("2"), hash("3"), hash("4")],
      recoveryOperatorIdentityHash: hash("5"),
    },
  };
}

describe("KMS custody and recovery evidence", () => {
  it("accepts four distinct recovered assets with complete production controls", () => {
    const report = verifyKmsCustodyReport(fixture(), new Date("2026-08-31T00:02:00.000Z"));
    expect(kmsCustodyBindingBlockers({
      report, candidateBuildId: report.candidateBuildId, candidateCreatedAt: "2026-08-30T23:00:00.000Z",
      deploymentManifestSha256: report.deploymentManifestSha256, releaseCreatedAt: "2026-08-31T00:02:00.000Z",
    })).toEqual([]);
  });

  it("rejects duplicate wallets, principals, audit events and post-start version changes", () => {
    const duplicateWallet = fixture();
    duplicateWallet.assets[2].publicIdentity = duplicateWallet.assets[1].publicIdentity;
    expect(() => verifyKmsCustodyReport(duplicateWallet, afterFixture)).toThrow("KMS_EVIDENCE_WALLET_IDENTITY_REUSED");
    const duplicatePrincipal = fixture();
    duplicatePrincipal.assets[0].runtimePrincipalHashes.push(duplicatePrincipal.assets[0].runtimePrincipalHashes[0]!);
    expect(() => verifyKmsCustodyReport(duplicatePrincipal, afterFixture)).toThrow("KMS_EVIDENCE_PRINCIPAL_DUPLICATE");
    const duplicateAudit = fixture();
    duplicateAudit.recovery.providerAuditEventHashes[3] = duplicateAudit.recovery.providerAuditEventHashes[0]!;
    expect(() => verifyKmsCustodyReport(duplicateAudit, afterFixture)).toThrow("KMS_EVIDENCE_AUDIT_EVENT_DUPLICATE");
    const changed = fixture();
    changed.assets[0].lastChangedAt = "2026-08-31T00:00:01.000Z";
    expect(() => verifyKmsCustodyReport(changed, afterFixture)).toThrow("KMS_EVIDENCE_ASSET_VERSION_CHANGED_DURING_RECOVERY");
  });

  it("blocks local, stale, substituted and incomplete custody/recovery claims", () => {
    const report = fixture();
    report.custody.targetClass = "local-smoke";
    report.custody.provider = "local-smoke";
    report.custody.workloadIdentity = false;
    report.custody.primaryRegionHash = report.custody.recoveryRegionHash;
    report.assets[0].leastPrivilegePolicy = false;
    report.recovery.source = "local-smoke";
    report.recovery.walletSignatureRoundTrips = 0;
    expect(kmsCustodyBindingBlockers({
      report, candidateBuildId: "other", candidateCreatedAt: "2026-08-31T00:02:00.000Z",
      deploymentManifestSha256: hash("9"), releaseCreatedAt: "2026-09-10T00:00:00.000Z",
    })).toEqual([
      "PRODUCTION_RELEASE_KMS_CANDIDATE_MISMATCH", "PRODUCTION_RELEASE_KMS_DEPLOYMENT_MISMATCH",
      "PRODUCTION_RELEASE_KMS_PREDATES_CANDIDATE", "PRODUCTION_RELEASE_KMS_EVIDENCE_STALE",
      "PRODUCTION_RELEASE_KMS_TARGET_NOT_PRODUCTION", "PRODUCTION_RELEASE_KMS_CUSTODY_CONTROLS_INCOMPLETE",
      "PRODUCTION_RELEASE_KMS_ASSET_POLICY_INCOMPLETE", "PRODUCTION_RELEASE_KMS_RECOVERY_UNPROVEN",
    ]);
  });
});
