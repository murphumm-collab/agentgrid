import { describe, expect, it } from "vitest";
import { compileContracts, solidityCompilerVersion } from "../../contracts/scripts/compiler";
import { runtimeBytecodeHash } from "../../contracts/scripts/bytecode-verification";
import { runtimeContractKeys, runtimeContractManifest, verifyRuntimeContractCode } from "./runtime-contract-verification";

const artifactNames = {
  token: "TestToken", stakeManager: "StakeCreditManager", agentRegistry: "AgentRegistry",
  rewardVault: "RewardVault", taskRegistry: "TaskRegistry", disputeResolver: "DisputeResolver",
  competitionSlotPassRegistry: "CompetitionSlotPassRegistry",
  verificationPanel: "VerificationPanel", verificationArbitrationCourt: "VerificationArbitrationCourt",
  protocolEconomics: "ProtocolEconomics",
} as const;
const artifacts = compileContracts();

describe("runtime contract readiness manifest", () => {
  it("is generated from the exact current compiler output", () => {
    expect(runtimeContractManifest.compiler).toBe(solidityCompilerVersion());
    for (const key of runtimeContractKeys) {
      const artifact = artifacts[artifactNames[key]];
      expect(runtimeContractManifest.contracts[key].name).toBe(artifactNames[key]);
      expect(runtimeContractManifest.contracts[key].immutableReferences).toEqual(artifact.immutableReferences);
      expect(runtimeContractManifest.contracts[key].normalizedRuntimeBytecodeHash).toBe(runtimeBytecodeHash(artifact));
      expect(verifyRuntimeContractCode(key, artifact.deployedBytecode)).toBe(runtimeBytecodeHash(artifact));
    }
  });

  it("accepts constructor immutables but rejects any other opcode change", () => {
    const artifact = artifacts.StakeCreditManager;
    const mutable = artifact.deployedBytecode.slice(2).split("");
    const immutable = artifact.immutableReferences[0];
    mutable[immutable.start * 2] = mutable[immutable.start * 2] === "0" ? "1" : "0";
    expect(() => verifyRuntimeContractCode("stakeManager", `0x${mutable.join("")}`)).not.toThrow();

    const opcode = artifact.deployedBytecode.slice(2).split("");
    opcode[0] = opcode[0] === "0" ? "1" : "0";
    expect(() => verifyRuntimeContractCode("stakeManager", `0x${opcode.join("")}`)).toThrow("STAKEMANAGER_RUNTIME_BYTECODE_MISMATCH");
    expect(() => verifyRuntimeContractCode("token", "0x6000")).toThrow("TOKEN_RUNTIME_BYTECODE_MISMATCH");
  });
});
