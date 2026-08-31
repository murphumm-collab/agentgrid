import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { pilotSignoffMessage, verifyPilotSignoffBundle, type PilotSignoffDraft } from "./pilot-signoff";

const accounts = Array.from({ length: 8 }, (_, index) => privateKeyToAccount(`0x${String(index + 11).padStart(2, "0").repeat(32)}` as `0x${string}`));
const deploymentManifestSha256 = `sha256:${"a".repeat(64)}`;
const signedAt = "2026-08-30T01:00:00.000Z";

function draft(): PilotSignoffDraft {
  return {
    version: 1,
    chainId: 97,
    pilotId: "pilot-2026-08-31",
    deploymentManifestSha256,
    taskIds: ["5", "1", "3", "2", "4"],
    attestations: [
      { role: "PUBLISHER_INDEPENDENCE_REVIEW", signer: accounts[0].address, subjectAddresses: [accounts[6].address, accounts[5].address, accounts[7].address], evidenceHash: `sha256:${"1".repeat(64)}`, signedAt },
      { role: "AGENT_INDEPENDENCE_REVIEW", signer: accounts[1].address, subjectAddresses: [accounts[3].address, accounts[2].address, accounts[4].address], evidenceHash: `sha256:${"2".repeat(64)}`, signedAt },
      { role: "SUPPORT_OWNER", signer: accounts[2].address, subjectAddresses: [], evidenceHash: `sha256:${"3".repeat(64)}`, signedAt },
      { role: "DISPUTE_OWNER", signer: accounts[3].address, subjectAddresses: [], evidenceHash: `sha256:${"4".repeat(64)}`, signedAt },
      { role: "INCIDENT_RESPONSE_OWNER", signer: accounts[4].address, subjectAddresses: [], evidenceHash: `sha256:${"5".repeat(64)}`, signedAt },
      { role: "ROLLBACK_OWNER", signer: accounts[5].address, subjectAddresses: [], evidenceHash: `sha256:${"6".repeat(64)}`, signedAt },
    ],
  };
}

async function signedBundle() {
  const value = draft();
  return {
    ...value,
    attestations: await Promise.all(value.attestations.map(async (attestation) => {
      const signer = accounts.find((account) => account.address.toLowerCase() === attestation.signer.toLowerCase())!;
      const commitment = pilotSignoffMessage({ pilotId: value.pilotId, deploymentManifestSha256: value.deploymentManifestSha256, taskIds: value.taskIds, attestation });
      return { ...attestation, signature: await signer.signMessage({ message: commitment.message }) };
    })),
  };
}

describe("pilot sign-off bundle", () => {
  it("verifies exact deployment-bound independent reviews and launch-owner signatures", async () => {
    const bundle = await signedBundle();
    const verified = await verifyPilotSignoffBundle(bundle, new Date("2026-08-31T02:00:00Z"));
    expect(verified.attestations).toHaveLength(6);
    expect(verified.deploymentManifestSha256).toBe(deploymentManifestSha256);
    expect(verified.taskIds).toEqual(["1", "2", "3", "4", "5"]);
    expect(verified.attestations[0].subjectAddresses.map((address) => address.toLowerCase()))
      .toEqual([...verified.attestations[0].subjectAddresses].map((address) => address.toLowerCase()).sort());
  });

  it("rejects signature replay after deployment or subject substitution", async () => {
    const bundle = await signedBundle();
    await expect(verifyPilotSignoffBundle({ ...bundle, deploymentManifestSha256: `sha256:${"b".repeat(64)}` }))
      .rejects.toThrow("PILOT_SIGNOFF_SIGNATURE_INVALID");
    const changed = structuredClone(bundle);
    changed.attestations[0].subjectAddresses[0] = accounts[2].address;
    await expect(verifyPilotSignoffBundle(changed)).rejects.toThrow("PILOT_SIGNOFF_SIGNATURE_INVALID");
    await expect(verifyPilotSignoffBundle({ ...bundle, taskIds: ["1", "2", "3", "4", "6"] }))
      .rejects.toThrow("PILOT_SIGNOFF_SIGNATURE_INVALID");
  });

  it("rejects self-review, insufficient subjects, future time and duplicate role signer", async () => {
    const selfReview = draft();
    selfReview.attestations[0].subjectAddresses[0] = selfReview.attestations[0].signer;
    const base = await signedBundle();
    const commitment = pilotSignoffMessage({ pilotId: selfReview.pilotId, deploymentManifestSha256, taskIds: selfReview.taskIds, attestation: selfReview.attestations[0] });
    const signature = await accounts[0].signMessage({ message: commitment.message });
    await expect(verifyPilotSignoffBundle({ ...base, attestations: [{ ...selfReview.attestations[0], signature }, ...base.attestations.slice(1)] }))
      .rejects.toThrow("PILOT_SIGNOFF_REVIEWER_CONFLICT");

    const insufficient = structuredClone(base);
    insufficient.attestations[0].subjectAddresses = insufficient.attestations[0].subjectAddresses.slice(0, 2);
    await expect(verifyPilotSignoffBundle(insufficient)).rejects.toThrow();

    const futureDraft = draft();
    futureDraft.attestations[2].signedAt = "2026-09-01T04:00:00.000Z";
    const futureCommitment = pilotSignoffMessage({ pilotId: futureDraft.pilotId, deploymentManifestSha256, taskIds: futureDraft.taskIds, attestation: futureDraft.attestations[2] });
    const futureSignature = await accounts[2].signMessage({ message: futureCommitment.message });
    const futureBundle = await signedBundle();
    futureBundle.attestations[2] = { ...futureDraft.attestations[2], signature: futureSignature };
    await expect(verifyPilotSignoffBundle(futureBundle, new Date("2026-08-31T02:00:00Z"))).rejects.toThrow("PILOT_SIGNOFF_TIME_IN_FUTURE");

    const duplicate = await signedBundle();
    duplicate.attestations.push(duplicate.attestations[2]);
    await expect(verifyPilotSignoffBundle(duplicate)).rejects.toThrow("PILOT_SIGNOFF_DUPLICATE_ROLE_SIGNER");

    const duplicateTask = await signedBundle();
    duplicateTask.taskIds = ["1", "2", "3", "4", "4"];
    await expect(verifyPilotSignoffBundle(duplicateTask)).rejects.toThrow("PILOT_SIGNOFF_TASK_DUPLICATE");

    const roleConflictDraft = draft();
    roleConflictDraft.attestations[3].signer = roleConflictDraft.attestations[2].signer;
    const roleConflictCommitment = pilotSignoffMessage({
      pilotId: roleConflictDraft.pilotId,
      deploymentManifestSha256,
      taskIds: roleConflictDraft.taskIds,
      attestation: roleConflictDraft.attestations[3],
    });
    const roleConflictSignature = await accounts[2].signMessage({ message: roleConflictCommitment.message });
    const roleConflictBundle = await signedBundle();
    roleConflictBundle.attestations[3] = { ...roleConflictDraft.attestations[3], signature: roleConflictSignature };
    await expect(verifyPilotSignoffBundle(roleConflictBundle)).rejects.toThrow("PILOT_SIGNOFF_SIGNER_ROLE_CONFLICT");
  });
});
