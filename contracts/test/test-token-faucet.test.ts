import ganache from "ganache";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicClient, createWalletClient, custom, defineChain, parseEther, type Abi, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { compileContracts, type ContractArtifact } from "../scripts/compiler";

const mnemonic = "test test test test test test test test test test test junk";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const chain = defineChain({
  id: 31_343,
  name: "AgentGrid Test Token Faucet Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

describe("TestToken faucet", () => {
  let artifacts: Record<string, ContractArtifact>;
  let provider: ReturnType<typeof ganache.provider>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let owner: ReturnType<typeof createWalletClient>;
  let caller: ReturnType<typeof createWalletClient>;
  let otherCaller: ReturnType<typeof createWalletClient>;
  let token: Address;

  beforeAll(() => { artifacts = compileContracts(); });

  beforeEach(async () => {
    provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: chain.id }, wallet: { mnemonic, totalAccounts: 3, defaultBalance: 1_000 } });
    const transport = custom(provider as never);
    publicClient = createPublicClient({ chain, transport });
    owner = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 0 }), chain, transport });
    caller = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 1 }), chain, transport });
    otherCaller = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 2 }), chain, transport });
    const hash = await owner.deployContract({ abi: artifacts.TestToken.abi as Abi, bytecode: artifacts.TestToken.bytecode, args: [owner.account!.address] } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error("Missing TestToken deployment");
    token = receipt.contractAddress;
  });

  async function claim(wallet: ReturnType<typeof createWalletClient>) {
    const hash = await wallet.writeContract({ address: token, abi: artifacts.TestToken.abi as Abi, functionName: "faucet" } as never);
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function read(functionName: string, args: readonly unknown[] = []) {
    return publicClient.readContract({ address: token, abi: artifacts.TestToken.abi as Abi, functionName, args } as never);
  }

  it("mints the fixed amount only to the direct caller", async () => {
    await claim(caller);
    expect(await read("FAUCET_AMOUNT")).toBe(parseEther("10000"));
    expect(await read("balanceOf", [caller.account!.address])).toBe(parseEther("10000"));
    expect(await read("balanceOf", [otherCaller.account!.address])).toBe(0n);
  });

  it("rejects a second same-wallet claim during the on-chain cooldown", async () => {
    await claim(caller);
    await expect(claim(caller)).rejects.toThrow();
    expect(await read("balanceOf", [caller.account!.address])).toBe(parseEther("10000"));
  });

  it("keeps wallets independent and permits a new claim after cooldown", async () => {
    await claim(caller);
    await claim(otherCaller);
    const cooldown = await read("FAUCET_COOLDOWN") as bigint;
    await provider.request({ method: "evm_increaseTime", params: [Number(cooldown + 1n)] });
    await provider.request({ method: "evm_mine", params: [] });
    await claim(caller);
    expect(await read("balanceOf", [caller.account!.address])).toBe(parseEther("20000"));
    expect(await read("balanceOf", [otherCaller.account!.address])).toBe(parseEther("10000"));
  });
});
