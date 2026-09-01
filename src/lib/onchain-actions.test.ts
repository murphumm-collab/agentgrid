import { describe, expect, it } from "vitest";
import type { Abi } from "viem";
import {
  agentRegistryAbi, disputeResolverAbi, protocolEconomicsAbi, rewardVaultAbi, stakeManagerAbi,
  taskRegistryAbi, tokenAbi, verificationArbitrationCourtAbi, verificationPanelAbi,
} from "./contracts";
import { onChainActionContracts, onChainContractKeys } from "./onchain-actions";

const abis = {
  token: tokenAbi, stakeManager: stakeManagerAbi, agentRegistry: agentRegistryAbi, taskRegistry: taskRegistryAbi,
  rewardVault: rewardVaultAbi, verificationPanel: verificationPanelAbi,
  verificationArbitrationCourt: verificationArbitrationCourtAbi, disputeResolver: disputeResolverAbi,
  protocolEconomics: protocolEconomicsAbi,
} satisfies Record<(typeof onChainContractKeys)[number], Abi>;

const nonWalletEntrypoints = new Set([
  "taskRegistry.setVerificationPanel(address)",
  "taskRegistry.setCoordinator(address)",
  "taskRegistry.setDisputeResolver(address)",
  "taskRegistry.finalizeVerificationPanel(uint256,uint32,uint8,bool,address,bytes32,bytes32,uint16[],address[3],uint16[3])",
  "taskRegistry.resolveRejection(uint256,bool,bytes32)",
]);

function abiSignature(item: Extract<Abi[number], { type: "function" }>) {
  return `${item.name}(${item.inputs.map((input) => input.type).join(",")})`;
}

describe("AI on-chain action inventory", () => {
  it("enumerates every wallet-callable mutation from the public runtime ABIs exactly once", () => {
    const discovered = Object.entries(abis).flatMap(([contract, abi]) => abi
      .filter((item): item is Extract<Abi[number], { type: "function" }> => item.type === "function" && item.stateMutability !== "view" && item.stateMutability !== "pure")
      .map((item) => `${contract}.${abiSignature(item)}`)
      .filter((signature) => !nonWalletEntrypoints.has(signature)));
    const documented = onChainActionContracts.map((item) => `${item.contract}.${item.signature}`);
    expect(new Set(documented).size).toBe(documented.length);
    expect(documented.sort()).toEqual(discovered.sort());
    expect(onChainActionContracts).toHaveLength(44);
  });

  it("keeps governance and protocol-to-protocol functions outside the wallet action surface", () => {
    const documented = new Set(onChainActionContracts.map((item) => `${item.contract}.${item.signature}`));
    for (const signature of nonWalletEntrypoints) expect(documented.has(signature)).toBe(false);
    expect(onChainActionContracts.filter((item) => item.availability === "COMPATIBILITY").map((item) => item.id).sort()).toEqual([
      "create-task-legacy", "register-agent-legacy",
    ]);
    expect(onChainActionContracts.filter((item) => item.phase === "ARBITRATION")).toHaveLength(11);
  });
});
