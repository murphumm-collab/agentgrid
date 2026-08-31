import { keccak256, type Hex } from "viem";
import type { ContractArtifact } from "./compiler";

export function normalizedRuntimeBytecode(bytecode: Hex, immutableReferences: ContractArtifact["immutableReferences"]): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(bytecode)) throw new Error("RUNTIME_BYTECODE_INVALID");
  const characters = bytecode.slice(2).toLowerCase().split("");
  for (const reference of immutableReferences) {
    if (!Number.isInteger(reference.start) || !Number.isInteger(reference.length) || reference.start < 0 || reference.length < 1) throw new Error("IMMUTABLE_REFERENCE_INVALID");
    const start = reference.start * 2;
    const end = start + reference.length * 2;
    if (end > characters.length) throw new Error("IMMUTABLE_REFERENCE_OUT_OF_RANGE");
    characters.fill("0", start, end);
  }
  return `0x${characters.join("")}`;
}

export function runtimeBytecodeHash(artifact: ContractArtifact) {
  return keccak256(normalizedRuntimeBytecode(artifact.deployedBytecode, artifact.immutableReferences));
}

export function verifyRuntimeBytecode(name: string, onchainBytecode: Hex | undefined, artifact: ContractArtifact) {
  if (!onchainBytecode || onchainBytecode === "0x") throw new Error(`${name.toUpperCase()}_BYTECODE_MISSING`);
  const expected = normalizedRuntimeBytecode(artifact.deployedBytecode, artifact.immutableReferences);
  const actual = normalizedRuntimeBytecode(onchainBytecode, artifact.immutableReferences);
  if (actual !== expected) throw new Error(`${name.toUpperCase()}_RUNTIME_BYTECODE_MISMATCH`);
  return keccak256(actual);
}
