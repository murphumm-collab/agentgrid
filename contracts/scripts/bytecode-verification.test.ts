import { describe, expect, it } from "vitest";
import { normalizedRuntimeBytecode, verifyRuntimeBytecode } from "./bytecode-verification";
import type { ContractArtifact } from "./compiler";

const artifact: ContractArtifact = {
  abi: [], bytecode: "0x6000", deployedBytecode: "0x60001122336001", immutableReferences: [{ start: 2, length: 3 }],
};

describe("runtime bytecode verification", () => {
  it("ignores only compiler-declared immutable slots", () => {
    expect(normalizedRuntimeBytecode("0x6000aabbcc6001", artifact.immutableReferences)).toBe("0x60000000006001");
    expect(verifyRuntimeBytecode("Sample", "0x6000aabbcc6001", artifact)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects code changes outside immutable slots and invalid references", () => {
    expect(() => verifyRuntimeBytecode("Sample", "0x6100aabbcc6001", artifact)).toThrow("SAMPLE_RUNTIME_BYTECODE_MISMATCH");
    expect(() => normalizedRuntimeBytecode("0x6000", [{ start: 2, length: 1 }])).toThrow("IMMUTABLE_REFERENCE_OUT_OF_RANGE");
  });
});
