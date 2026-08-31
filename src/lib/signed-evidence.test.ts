import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { evidenceMessage, verifyEvidenceSignature } from "./signed-evidence";

describe("signed test evidence", () => {
  it("accepts the registered tester wallet and rejects another signer", async () => {
    const tester = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const input = { taskId: "7", artifactHash: `sha256:${"a".repeat(64)}`, report: { passed: true, coverage: { lines: 95 } } };
    const commitment = evidenceMessage(input);
    const signature = await tester.signMessage({ message: commitment.message });
    await expect(verifyEvidenceSignature({ ...input, signature, expectedAddress: tester.address })).resolves.toMatchObject({ signer: tester.address });
    await expect(verifyEvidenceSignature({ ...input, signature, expectedAddress: `0x${"2".repeat(40)}` })).rejects.toThrow("TEST_EVIDENCE_SIGNATURE_INVALID");
  });
});
