import ganache from "ganache";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient, createWalletClient, custom, defineChain, keccak256,
  stringToHex, type Abi, type Address,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { compileContracts, type ContractArtifact } from "../scripts/compiler";
import { governedSelectionGasRegistrySize, governedSelectionTransactionGasLimit } from "../../src/lib/selection-policy";

const mnemonic = "test test test test test test test test test test test junk";
vi.setConfig({ testTimeout: 240_000, hookTimeout: 180_000 });
const chain = defineChain({
  id: 31_340,
  name: "AgentGrid Selection Gas Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

describe("AgentRegistry governed maximum selection gas", () => {
  let artifacts: Record<string, ContractArtifact>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let wallets: Array<ReturnType<typeof createWalletClient>>;
  let registry: Address;
  let requester: Address;

  beforeAll(() => {
    const fixtures = path.resolve(process.cwd(), "contracts/test/fixtures");
    artifacts = compileContracts({
      "SelectionGasHarness.sol": { content: readFileSync(path.join(fixtures, "SelectionGasHarness.sol"), "utf8") },
      "SelectionRequesterHarness.sol": { content: readFileSync(path.join(fixtures, "SelectionRequesterHarness.sol"), "utf8") },
    });
  });

  beforeEach(async () => {
    const provider = ganache.provider({
      logging: { quiet: true },
      chain: { chainId: chain.id },
      miner: { blockGasLimit: 100_000_000 },
      wallet: { mnemonic, totalAccounts: 2, defaultBalance: 1_000 },
    });
    const transport = custom(provider as never);
    publicClient = createPublicClient({ chain, transport });
    wallets = [0, 1].map((addressIndex) => createWalletClient({
      account: mnemonicToAccount(mnemonic, { addressIndex }), chain, transport,
    }));
    const token = await deploy("TestToken", [wallets[0].account!.address]);
    const stakeManager = await deploy("StakeCreditManager", [token, wallets[0].account!.address]);
    registry = await deploy("SelectionGasHarness", [stakeManager]);
    requester = await deploy("SelectionRequesterHarness", [registry]);
  });

  async function deploy(name: string, args: readonly unknown[]) {
    const artifact = artifacts[name];
    const hash = await wallets[0].deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode, args } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Missing deployment address for ${name}`);
    return receipt.contractAddress;
  }

  async function write(address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    const hash = await wallets[0].writeContract({ address, abi: artifacts[name].abi as Abi, functionName, args } as never);
    return publicClient.waitForTransactionReceipt({ hash });
  }

  it("keeps the exact worst last build page and bounded prune transaction below the governed gas budget", async () => {
    const poolId = keccak256(stringToHex("governed-65536-candidate-selection-gas"));
    await write(registry, "SelectionGasHarness", "prepareSparsePool", [
      poolId, requester, governedSelectionGasRegistrySize, 64,
    ]);
    const buildReceipt = await write(registry, "SelectionGasHarness", "buildSelectionPool", [poolId, 64]);
    expect(buildReceipt.gasUsed).toBeLessThanOrEqual(BigInt(governedSelectionTransactionGasLimit));
    for (let index = 0; index < 6; index += 1) await publicClient.request({ method: "evm_mine" as never });
    const drawReceipt = await write(requester, "SelectionRequesterHarness", "draw", [poolId, 16]);
    expect(drawReceipt.gasUsed).toBeLessThanOrEqual(BigInt(governedSelectionTransactionGasLimit));

    const pool = await publicClient.readContract({
      address: registry, abi: artifacts.SelectionGasHarness.abi as Abi,
      functionName: "selectionPoolStatus", args: [poolId],
    } as never) as readonly unknown[];
    expect(pool[2]).toBe(0);
    expect(pool[3]).toBe(true);
  });
});
