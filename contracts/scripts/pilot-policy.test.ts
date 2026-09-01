import { describe, expect, it } from "vitest";
import { bscTestnetGenesisHash, isPrivateNetworkAddress, publicBscRpcTransport, validateBscTestnetIdentity, validatePilotRoleSeparation, validatePilotRpcUrl } from "./pilot-policy";

const address = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;

describe("BSC pilot policy", () => {
  it("rejects local, private, cleartext and credential-bearing RPC endpoints", () => {
    for (const url of ["http://rpc.example.com", "https://localhost:8545", "https://127.0.0.1", "https://10.1.2.3", "https://user:secret@rpc.example.com"]) {
      expect(() => validatePilotRpcUrl(url)).toThrow();
    }
    expect(validatePilotRpcUrl("https://bsc-testnet-dataseed.bnbchain.org")).toBe("https://bsc-testnet-dataseed.bnbchain.org/");
    expect(isPrivateNetworkAddress("192.168.1.2")).toBe(true);
    expect(isPrivateNetworkAddress("8.8.8.8")).toBe(false);
    const configured = publicBscRpcTransport("https://rpc.example")({ chain: undefined, retryCount: 0, timeout: 0 });
    expect(configured.config.retryCount).toBe(2);
    expect(configured.value?.fetchOptions).toMatchObject({ redirect: "error" });
  });

  it("requires distinct role wallets separated from protocol authorities", () => {
    const roles = { publisher: address("1"), evaluator1: address("2"), evaluator2: address("3"), evaluator3: address("4"), executor: address("5"), tester: address("6"), coordinator: address("7") };
    expect(validatePilotRoleSeparation(roles, [address("8")])).toBe(true);
    expect(() => validatePilotRoleSeparation({ ...roles, tester: roles.executor }, [address("8")])).toThrow("PILOT_ROLE_WALLETS_MUST_BE_DISTINCT");
    expect(() => validatePilotRoleSeparation({ ...roles, publisher: address("8") }, [address("8")])).toThrow("PILOT_PUBLISHER_CONFLICTS_WITH_PROTOCOL_AUTHORITY");
  });

  it("binds execution to the live BSC Testnet identity", () => {
    expect(validateBscTestnetIdentity({ chainId: 97, genesisHash: bscTestnetGenesisHash, latestTimestamp: 1_000n, nowSeconds: 1_010 })).toBe(10);
    expect(() => validateBscTestnetIdentity({ chainId: 31_337, genesisHash: bscTestnetGenesisHash, latestTimestamp: 1_000n, nowSeconds: 1_010 })).toThrow();
    expect(() => validateBscTestnetIdentity({ chainId: 97, genesisHash: address("0"), latestTimestamp: 1_000n, nowSeconds: 1_010 })).toThrow();
    expect(() => validateBscTestnetIdentity({ chainId: 97, genesisHash: bscTestnetGenesisHash, latestTimestamp: 1_000n, nowSeconds: 1_400 })).toThrow();
  });
});
