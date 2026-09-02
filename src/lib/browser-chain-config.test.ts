import { describe, expect, it } from "vitest";
import { parseBrowserChainConfig } from "./browser-chain-config";

const contracts = {
  token: "0x1111111111111111111111111111111111111111",
  stakeManager: "0x2222222222222222222222222222222222222222",
  agentRegistry: "0x3333333333333333333333333333333333333333",
  taskRegistry: "0x4444444444444444444444444444444444444444",
  rewardVault: "0x5555555555555555555555555555555555555555",
  verificationPanel: "0x6666666666666666666666666666666666666666",
  verificationArbitrationCourt: "0x7777777777777777777777777777777777777777",
  disputeResolver: "0x8888888888888888888888888888888888888888",
  protocolEconomics: "0x9999999999999999999999999999999999999999",
  competitionSlotPassRegistry: "0x1010101010101010101010101010101010101010",
};

describe("browser chain config", () => {
  it("accepts the BSC Testnet runtime configuration", () => {
    expect(parseBrowserChainConfig({ chainId: 97, confirmations: 5, walletConnectProjectId: "0123456789abcdef", contracts })).toEqual({
      chainId: 97, confirmations: 5, walletConnectProjectId: "0123456789abcdef", contracts,
    });
  });

  it("rejects unsupported networks, confirmation counts and addresses", () => {
    expect(() => parseBrowserChainConfig({ chainId: 56, confirmations: 5, contracts })).toThrow();
    expect(() => parseBrowserChainConfig({ chainId: 97, confirmations: 0, contracts })).toThrow();
    expect(() => parseBrowserChainConfig({ chainId: 97, confirmations: 5, contracts: { ...contracts, token: "0xbroken" } })).toThrow();
  });
});
