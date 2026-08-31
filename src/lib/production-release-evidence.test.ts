import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  productionReleaseMessage, verifyProductionReleaseBundle,
  type ProductionReleaseManifest, type UnsignedProductionReleaseAttestation,
} from "./production-release-evidence";

const accounts = Array.from({ length: 3 }, (_, index) => privateKeyToAccount(`0x${String(index + 41).repeat(32)}` as `0x${string}`));
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function manifest(): ProductionReleaseManifest {
  const file = (name: string, character: string) => ({ file: `${name}.json`, sha256: digest(character) });
  return {
    version: 1,
    chainId: 97,
    releaseId: "agentgrid-release-2026-08-31",
    createdAt: "2026-08-31T01:00:00.000Z",
    candidateBuildId: "candidate-build-123",
    images: { web: digest("1"), workers: digest("2"), ops: digest("3") },
    files: {
      candidateReleaseManifest: file("candidate", "4"), deploymentManifest: file("deployment", "5"), pilotSignoffBundle: file("pilot", "6"),
      contractVerificationReport: file("contracts", "7"), applicationQaReport: file("qa", "8"), backupRestoreReport: file("backup", "9"),
      offsiteBackupReport: file("offsite", "a"), monitoringAlertDrillReport: file("monitor", "b"), tlsWafTrustedProxyReport: file("tls", "c"),
      kmsCustodyRecoveryReport: file("kms", "d"), independentSolidityAuditReport: file("solidity-audit", "e"), independentWebApiAuditReport: file("web-audit", "f"),
    },
  };
}

const roles = ["PROTOCOL_OWNER", "SECURITY_REVIEWER", "OPERATIONS_OWNER"] as const;

async function bundle() {
  const value = manifest();
  const attestations = await Promise.all(roles.map(async (role, index) => {
    const attestation: UnsignedProductionReleaseAttestation = { role, signer: accounts[index].address, signedAt: "2026-08-31T02:00:00.000Z" };
    const commitment = productionReleaseMessage({ manifest: value, attestation });
    return { ...attestation, signature: await accounts[index].signMessage({ message: commitment.message }) };
  }));
  return { ...value, attestations };
}

describe("production release evidence signatures", () => {
  it("verifies three distinct roles over one exact release manifest", async () => {
    const verified = await verifyProductionReleaseBundle(await bundle(), new Date("2026-08-31T03:00:00Z"));
    expect(verified.attestations.map((item) => item.role)).toEqual(roles);
    expect(verified.manifest.candidateBuildId).toBe("candidate-build-123");
  });

  it("rejects substituted evidence, duplicate signers and signatures before the manifest", async () => {
    const substituted = await bundle();
    substituted.files.kmsCustodyRecoveryReport.sha256 = digest("1");
    await expect(verifyProductionReleaseBundle(substituted, new Date("2026-08-31T03:00:00Z"))).rejects.toThrow("PRODUCTION_RELEASE_SIGNATURE_INVALID");

    const duplicateSigner = await bundle();
    const replacement = { role: "SECURITY_REVIEWER" as const, signer: accounts[0].address, signedAt: "2026-08-31T02:00:00.000Z" };
    const commitment = productionReleaseMessage({ manifest: manifest(), attestation: replacement });
    duplicateSigner.attestations[1] = { ...replacement, signature: await accounts[0].signMessage({ message: commitment.message }) };
    await expect(verifyProductionReleaseBundle(duplicateSigner, new Date("2026-08-31T03:00:00Z"))).rejects.toThrow("PRODUCTION_RELEASE_SIGNER_ROLE_CONFLICT");

    const predates = await bundle();
    const early = { role: "OPERATIONS_OWNER" as const, signer: accounts[2].address, signedAt: "2026-08-31T00:00:00.000Z" };
    const earlyCommitment = productionReleaseMessage({ manifest: manifest(), attestation: early });
    predates.attestations[2] = { ...early, signature: await accounts[2].signMessage({ message: earlyCommitment.message }) };
    await expect(verifyProductionReleaseBundle(predates, new Date("2026-08-31T03:00:00Z"))).rejects.toThrow("PRODUCTION_RELEASE_SIGNATURE_PREDATES_MANIFEST");
  });

  it("rejects traversal and zero-digest placeholders", () => {
    const unsafe = manifest();
    unsafe.files.applicationQaReport.file = "../qa.json";
    expect(() => productionReleaseMessage({ manifest: unsafe, attestation: { role: roles[0], signer: accounts[0].address, signedAt: "2026-08-31T02:00:00Z" } })).toThrow();
    const zero = manifest();
    zero.images.web = digest("0");
    expect(() => productionReleaseMessage({ manifest: zero, attestation: { role: roles[0], signer: accounts[0].address, signedAt: "2026-08-31T02:00:00Z" } })).toThrow();
  });
});
