import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Abi } from "viem";
import {
  agentRegistryAbi, competitionSlotPassRegistryAbi, disputeResolverAbi, protocolEconomicsAbi, rewardVaultAbi, stakeManagerAbi,
  taskRegistryAbi, tokenAbi, verificationArbitrationCourtAbi, verificationPanelAbi,
} from "./contracts";
import { onChainActionContracts, onChainActionExclusions, onChainContractKeys } from "./onchain-actions";

const clientAbis = {
  token: tokenAbi, stakeManager: stakeManagerAbi, agentRegistry: agentRegistryAbi, taskRegistry: taskRegistryAbi,
  rewardVault: rewardVaultAbi, verificationPanel: verificationPanelAbi,
  verificationArbitrationCourt: verificationArbitrationCourtAbi, disputeResolver: disputeResolverAbi,
  protocolEconomics: protocolEconomicsAbi,
  competitionSlotPassRegistry: competitionSlotPassRegistryAbi,
} satisfies Record<(typeof onChainContractKeys)[number], Abi>;

const artifactNames = {
  token: "TestToken", stakeManager: "StakeCreditManager", agentRegistry: "AgentRegistry", taskRegistry: "TaskRegistry",
  rewardVault: "RewardVault", verificationPanel: "VerificationPanel",
  verificationArbitrationCourt: "VerificationArbitrationCourt", disputeResolver: "DisputeResolver",
  protocolEconomics: "ProtocolEconomics",
  competitionSlotPassRegistry: "CompetitionSlotPassRegistry",
} satisfies Record<(typeof onChainContractKeys)[number], string>;

function abiSignature(item: Extract<Abi[number], { type: "function" }>) {
  return `${item.name}(${item.inputs.map((input) => input.type).join(",")})`;
}

function mutableSignatures(contract: string, abi: Abi) {
  return abi
    .filter((item): item is Extract<Abi[number], { type: "function" }> => item.type === "function" && item.stateMutability !== "view" && item.stateMutability !== "pure")
    .map((item) => `${contract}.${abiSignature(item)}`);
}

function artifactAbi(name: string): Abi {
  const artifact = JSON.parse(readFileSync(new URL(`../../contracts/artifacts/${name}.json`, import.meta.url), "utf8")) as { abi: Abi };
  return artifact.abi;
}

describe("AI on-chain action inventory", () => {
  it("partitions every compiled deployment ABI mutation into a participant action or explicit exclusion", () => {
    const compiled = Object.entries(artifactNames).flatMap(([contract, name]) => mutableSignatures(contract, artifactAbi(name)));
    const actions = onChainActionContracts.map((item) => `${item.contract}.${item.signature}`);
    const exclusions = onChainActionExclusions.map((item) => `${item.contract}.${item.signature}`);
    expect(onChainActionContracts).toHaveLength(46);
    expect(onChainActionExclusions).toHaveLength(62);
    expect(compiled).toHaveLength(108);
    expect(new Set(actions).size).toBe(actions.length);
    expect(new Set(exclusions).size).toBe(exclusions.length);
    expect(actions.filter((signature) => exclusions.includes(signature))).toEqual([]);
    expect([...actions, ...exclusions].sort()).toEqual(compiled.sort());
  });

  it("keeps every supported action in the safe client ABI and classifies every exclusion", () => {
    const clientSurface = new Set(Object.entries(clientAbis).flatMap(([contract, abi]) => mutableSignatures(contract, abi)));
    for (const action of onChainActionContracts) expect(clientSurface.has(`${action.contract}.${action.signature}`), action.id).toBe(true);
    expect(onChainActionContracts.filter((item) => item.availability === "COMPATIBILITY").map((item) => item.id).sort()).toEqual([
      "create-task-legacy", "register-agent-legacy",
    ]);
    expect(onChainActionContracts.filter((item) => item.phase === "ARBITRATION")).toHaveLength(11);
    expect(new Set(onChainActionExclusions.map((item) => item.classification))).toEqual(new Set([
      "GOVERNANCE_ONLY", "PROTOCOL_INTERNAL", "TOKEN_TRANSFER_OUTSIDE_AGENTGRID_WORKFLOW",
    ]));
    expect(onChainActionContracts.some((item) => item.contract === "competitionSlotPassRegistry")).toBe(false);
    expect(onChainActionExclusions.filter((item) => item.contract === "competitionSlotPassRegistry")).toEqual(expect.arrayContaining([
      expect.objectContaining({ signature: "registerAuthorization(tuple,bytes)", classification: "PROTOCOL_INTERNAL" }),
      expect.objectContaining({ signature: "consume(bytes32,address,bytes32,bytes32,bytes32,uint256,uint8,uint8)", classification: "PROTOCOL_INTERNAL" }),
      expect.objectContaining({ signature: "consumeFor(address,bytes32,uint8)", classification: "PROTOCOL_INTERNAL" }),
      expect.objectContaining({ signature: "setIssuer(address)", classification: "GOVERNANCE_ONLY" }),
    ]));
    expect(onChainActionExclusions).toContainEqual(expect.objectContaining({
      contract: "taskRegistry", signature: "setCompetitionSlotPassRegistry(address)", classification: "GOVERNANCE_ONLY",
    }));
  });
});
