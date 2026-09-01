import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { evidenceMessage, storedEvidenceHash, testEvidenceSigningVersion, verifyEvidenceSignature, verifyStoredTestEvidence } from "./signed-evidence";

describe("signed test evidence", () => {
  it("accepts the registered tester wallet and rejects another signer", async () => {
    const tester = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const executor = `0x${"3".repeat(40)}`;
    const input = {
      chainId: 97 as const, taskRegistry: `0x${"a".repeat(40)}`, taskId: "7", workRound: 2,
      checkpoint: 2, panelEpoch: 4, verificationShard: 1,
      executionMode: "COLLABORATION" as const, executorOrder: [executor], artifactHash: `sha256:${"a".repeat(64)}`,
      report: {
        passed: true, exitCode: 0, timedOut: false, durationMs: 1200, testsPassed: true, hiddenTestsPassed: true,
        lineCoverage: 0.95, branchCoverage: 0.94, functionCoverage: 0.96, criticalBranchCoverage: 0.93,
        stdout: "ok", stderr: "", sandbox: { network: "none" as const, readOnlyRoot: true as const, memoryMb: 256, cpus: 1, pids: 64, image: "agentgrid/tester:fixed" },
        contributionWork: [], executorWeightsBps: [10_000],
      },
    };
    const commitment = evidenceMessage(input);
    const signature = await tester.signMessage({ message: commitment.message });
    await expect(verifyEvidenceSignature({ ...input, signature, expectedAddress: tester.address })).resolves.toMatchObject({ signer: tester.address });
    await expect(verifyEvidenceSignature({ ...input, signature, expectedAddress: `0x${"2".repeat(40)}` })).rejects.toThrow("TEST_EVIDENCE_SIGNATURE_INVALID");
    await expect(verifyEvidenceSignature({ ...input, workRound: 3, signature, expectedAddress: tester.address })).rejects.toThrow("TEST_EVIDENCE_SIGNATURE_INVALID");
    await expect(verifyEvidenceSignature({ ...input, executorOrder: [`0x${"4".repeat(40)}`], signature, expectedAddress: tester.address })).rejects.toThrow("TEST_EVIDENCE_SIGNATURE_INVALID");
    const stored = {
      taskId: input.taskId, testerAddress: tester.address, artifactHash: input.artifactHash,
      reportHash: commitment.reportHash, report: input.report, signature,
      signingVersion: testEvidenceSigningVersion, signingMessage: commitment.message, expectedTaskRegistry: input.taskRegistry,
      expectedWorkRound: input.workRound, expectedExecutionMode: input.executionMode, expectedExecutorOrder: input.executorOrder,
      expectedCheckpoint: input.checkpoint, expectedPanelEpoch: input.panelEpoch, expectedVerificationShard: input.verificationShard,
    };
    await expect(verifyStoredTestEvidence(stored)).resolves.toBe(true);
    await expect(verifyStoredTestEvidence({ ...stored, expectedTaskRegistry: `0x${"b".repeat(40)}` })).resolves.toBe(false);
    await expect(verifyStoredTestEvidence({ ...stored, expectedWorkRound: 3 })).resolves.toBe(false);
    await expect(verifyStoredTestEvidence({ ...stored, expectedCheckpoint: 1 })).resolves.toBe(false);
    await expect(verifyStoredTestEvidence({ ...stored, expectedPanelEpoch: 5 })).resolves.toBe(false);
    await expect(verifyStoredTestEvidence({ ...stored, expectedVerificationShard: 2 })).resolves.toBe(false);
    await expect(verifyStoredTestEvidence({ ...stored, expectedExecutionMode: "COMPETITION" })).resolves.toBe(false);
    await expect(verifyStoredTestEvidence({ ...stored, expectedExecutorOrder: [`0x${"4".repeat(40)}`] })).resolves.toBe(false);
    await expect(verifyStoredTestEvidence({ ...stored, report: { ...input.report, stdout: "tampered" } })).resolves.toBe(false);
    await expect(verifyStoredTestEvidence({ ...stored, signingMessage: stored.signingMessage.replace("Work round: 2", "Work round: 3") })).resolves.toBe(false);
    const legacyMessage = `AgentGrid Test Evidence\nTask: ${input.taskId}\nArtifact: ${input.artifactHash}\nReport: ${commitment.reportHash}`;
    const legacySignature = await tester.signMessage({ message: legacyMessage });
    await expect(verifyStoredTestEvidence({ ...stored, signature: legacySignature, signingVersion: null, signingMessage: null })).resolves.toBe(false);
    await expect(verifyStoredTestEvidence({ ...stored, signature: legacySignature, signingVersion: null, signingMessage: null, allowLegacy: true })).resolves.toBe(true);
  });

  it("derives the broadcast hash only from the canonical stored row", () => {
    const stored = { reportHash: `0x${"a".repeat(64)}`, testerAddress: `0x${"b".repeat(40)}`, signature: `0x${"c".repeat(130)}` };
    const canonical = storedEvidenceHash(stored);
    expect(storedEvidenceHash({ ...stored, testerAddress: stored.testerAddress.toUpperCase().replace("0X", "0x"), signature: stored.signature.toUpperCase().replace("0X", "0x") })).toBe(canonical);
    expect(storedEvidenceHash({ ...stored, signature: `0x${"d".repeat(130)}` })).not.toBe(canonical);
  });
});
