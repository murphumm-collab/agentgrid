import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertBusinessAdoptionEligibility,
  businessAdoptionMessage,
  type BusinessAdoptionReport,
  verifyBusinessAdoptionSignature,
} from "./business-adoption";

const publisher = privateKeyToAccount(`0x${"42".repeat(32)}`);
const artifactHash = `sha256:${"a".repeat(64)}`;
const release = {
  id: "ca046ab9-0d7e-42e8-ada5-938311e83e2e",
  taskId: "7",
  publisher: publisher.address,
  artifactHash,
  createdAt: "2026-08-31T01:00:00.000Z",
};
const task = {
  id: "7",
  publisher: publisher.address,
  state: "MAINTENANCE",
  submission: { artifactHash: keccak256(stringToHex(artifactHash)) },
};
const report: BusinessAdoptionReport = {
  version: 1,
  chainId: 97,
  taskId: "7",
  publisher: publisher.address,
  releaseId: release.id,
  artifactHash,
  releasedAt: release.createdAt,
  workflowType: "PRODUCTION_DEPLOYED",
  workflowEvidenceHash: `sha256:${"b".repeat(64)}`,
  adoptedAt: "2026-08-31T02:00:00.000Z",
};

describe("publisher-signed business adoption", () => {
  it("binds the publisher signature to task, chain, release and final artifact", async () => {
    const commitment = businessAdoptionMessage(report);
    const signature = await publisher.signMessage({ message: commitment.message });
    await expect(verifyBusinessAdoptionSignature({ report, signature, expectedAddress: publisher.address }))
      .resolves.toMatchObject({ reportHash: commitment.reportHash, signer: publisher.address });
    await expect(verifyBusinessAdoptionSignature({ report: { ...report, taskId: "8" }, signature, expectedAddress: publisher.address }))
      .rejects.toThrow("BUSINESS_ADOPTION_SIGNATURE_INVALID");
    await expect(verifyBusinessAdoptionSignature({ report: { ...report, artifactHash: `sha256:${"c".repeat(64)}` }, signature, expectedAddress: publisher.address }))
      .rejects.toThrow("BUSINESS_ADOPTION_SIGNATURE_INVALID");
  });

  it("allows confirmation only after an exact audited release of the accepted chain artifact", () => {
    expect(assertBusinessAdoptionEligibility({ report, task, release, sessionAddress: publisher.address, expectedChainId: 97, now: new Date("2026-08-31T02:01:00Z") }))
      .toMatchObject({ chainArtifactHash: task.submission.artifactHash });
    expect(() => assertBusinessAdoptionEligibility({ report, task, release: undefined, sessionAddress: publisher.address, expectedChainId: 97 }))
      .toThrow("ARTIFACT_RELEASE_REQUIRED");
    expect(() => assertBusinessAdoptionEligibility({ report, task: { ...task, state: "USER_REVIEW" }, release, sessionAddress: publisher.address, expectedChainId: 97 }))
      .toThrow("BUSINESS_ADOPTION_REQUIRES_ACCEPTED_TASK");
    expect(() => assertBusinessAdoptionEligibility({ report, task, release: { ...release, artifactHash: `sha256:${"c".repeat(64)}` }, sessionAddress: publisher.address, expectedChainId: 97 }))
      .toThrow("BUSINESS_ADOPTION_ARTIFACT_MISMATCH");
  });

  it("rejects another wallet, a substituted release, an early claim and a future timestamp", () => {
    const other = `0x${"1".repeat(40)}`;
    expect(() => assertBusinessAdoptionEligibility({ report, task, release, sessionAddress: other, expectedChainId: 97 }))
      .toThrow("BUSINESS_ADOPTION_PUBLISHER_DENIED");
    expect(() => assertBusinessAdoptionEligibility({ report: { ...report, releaseId: "7a59a27e-d166-4f57-b5ba-532816da4a73" }, task, release, sessionAddress: publisher.address, expectedChainId: 97 }))
      .toThrow("BUSINESS_ADOPTION_RELEASE_MISMATCH");
    expect(() => assertBusinessAdoptionEligibility({ report: { ...report, adoptedAt: "2026-08-31T00:59:59.000Z" }, task, release, sessionAddress: publisher.address, expectedChainId: 97 }))
      .toThrow("BUSINESS_ADOPTION_BEFORE_RELEASE");
    expect(() => assertBusinessAdoptionEligibility({ report: { ...report, adoptedAt: "2026-08-31T03:00:00.000Z" }, task, release, sessionAddress: publisher.address, expectedChainId: 97, now: new Date("2026-08-31T02:00:00Z") }))
      .toThrow("BUSINESS_ADOPTION_TIME_IN_FUTURE");
  });

  it("invalidates an old adoption after a maintenance artifact replacement", () => {
    const replacementArtifact = `sha256:${"d".repeat(64)}`;
    const replacementTask = { ...task, submission: { artifactHash: keccak256(stringToHex(replacementArtifact)) } };
    expect(() => assertBusinessAdoptionEligibility({ report, task: replacementTask, release, sessionAddress: publisher.address, expectedChainId: 97 }))
      .toThrow("BUSINESS_ADOPTION_CHAIN_ARTIFACT_MISMATCH");
    const replacementRelease = { ...release, id: "34eadac4-71e8-4f61-a3c6-a8f4680c19a9", artifactHash: replacementArtifact };
    const replacementReport = { ...report, releaseId: replacementRelease.id, artifactHash: replacementArtifact };
    expect(assertBusinessAdoptionEligibility({ report: replacementReport, task: replacementTask, release: replacementRelease, sessionAddress: publisher.address, expectedChainId: 97, now: new Date("2026-08-31T02:01:00Z") }))
      .toMatchObject({ chainArtifactHash: replacementTask.submission.artifactHash });
  });
});
