import { keccak256, type Hex } from "viem";
import { z } from "zod";
import rawManifest from "@/generated/runtime-contract-manifest.json";

export const runtimeContractKeys = ["token", "stakeManager", "agentRegistry", "rewardVault", "taskRegistry", "verificationPanel", "verificationArbitrationCourt", "disputeResolver"] as const;
export type RuntimeContractKey = typeof runtimeContractKeys[number];

const referenceSchema = z.object({ start: z.number().int().nonnegative(), length: z.number().int().positive() }).strict();
const contractSchema = z.object({
  name: z.string().min(1),
  normalizedRuntimeBytecodeHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  immutableReferences: z.array(referenceSchema),
}).strict();
const manifestSchema = z.object({
  version: z.literal(1),
  compiler: z.string().min(1),
  contracts: z.object(Object.fromEntries(runtimeContractKeys.map((key) => [key, contractSchema])) as Record<RuntimeContractKey, typeof contractSchema>).strict(),
}).strict();

export const runtimeContractManifest = manifestSchema.parse(rawManifest);

export function normalizedRuntimeContractCode(code: string, references: Array<{ start: number; length: number }>) {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new Error("RUNTIME_CONTRACT_BYTECODE_INVALID");
  const characters = code.slice(2).toLowerCase().split("");
  for (const reference of references) {
    const start = reference.start * 2;
    const end = start + reference.length * 2;
    if (end > characters.length) throw new Error("RUNTIME_CONTRACT_IMMUTABLE_REFERENCE_OUT_OF_RANGE");
    characters.fill("0", start, end);
  }
  return `0x${characters.join("")}` as Hex;
}

export function verifyRuntimeContractCode(key: RuntimeContractKey, code: string) {
  const expected = runtimeContractManifest.contracts[key];
  const actualHash = keccak256(normalizedRuntimeContractCode(code, expected.immutableReferences));
  if (actualHash !== expected.normalizedRuntimeBytecodeHash) throw new Error(`${key.toUpperCase()}_RUNTIME_BYTECODE_MISMATCH`);
  return actualHash;
}

export function verifyRuntimeContractSet(codes: Record<RuntimeContractKey, string>) {
  return Object.fromEntries(runtimeContractKeys.map((key) => [key, verifyRuntimeContractCode(key, codes[key])])) as Record<RuntimeContractKey, Hex>;
}
