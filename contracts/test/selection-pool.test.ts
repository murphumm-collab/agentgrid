import ganache from "ganache";
import { readFileSync } from "node:fs";
import path from "node:path";
import solc from "solc";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient, createWalletClient, custom, defineChain, keccak256,
  parseEther, stringToHex, type Abi, type Address,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { compileContracts, type ContractArtifact } from "../scripts/compiler";

const mnemonic = "test test test test test test test test test test test junk";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const chain = defineChain({
  id: 31_339,
  name: "AgentGrid Selection Pool Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

describe("AgentRegistry paginated selection pool", () => {
  let artifacts: Record<string, ContractArtifact>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let wallets: Array<ReturnType<typeof createWalletClient>>;
  let token: Address;
  let stakeManager: Address;
  let registry: Address;
  let requester: Address;

  beforeAll(() => {
    artifacts = compileContracts();
    const fixtureName = "SelectionRequesterHarness.sol";
    const input = {
      language: "Solidity",
      sources: { [fixtureName]: { content: readFileSync(path.resolve(process.cwd(), "contracts/test/fixtures", fixtureName), "utf8") } },
      settings: { optimizer: { enabled: true, runs: 1 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const fixture = output.contracts[fixtureName].SelectionRequesterHarness;
    artifacts.SelectionRequesterHarness = {
      abi: fixture.abi,
      bytecode: `0x${fixture.evm.bytecode.object}`,
      deployedBytecode: `0x${fixture.evm.deployedBytecode.object}`,
      immutableReferences: [],
    };
  });

  beforeEach(async () => {
    const provider = ganache.provider({
      logging: { quiet: true }, chain: { chainId: chain.id },
      wallet: { mnemonic, totalAccounts: 8, defaultBalance: 1_000 },
    });
    const transport = custom(provider as never);
    publicClient = createPublicClient({ chain, transport });
    wallets = Array.from({ length: 7 }, (_, index) => createWalletClient({
      account: mnemonicToAccount(mnemonic, { addressIndex: index }), chain, transport,
    }));
    token = await deploy(0, "TestToken", [wallets[0].account!.address]);
    stakeManager = await deploy(0, "StakeCreditManager", [token, wallets[0].account!.address]);
    registry = await deploy(0, "AgentRegistry", [stakeManager]);
    requester = await deploy(0, "SelectionRequesterHarness", [registry]);
    await write(0, registry, "AgentRegistry", "setSelectionRequester", [requester]);
    for (let index = 1; index <= 5; index += 1) {
      await write(index, token, "TestToken", "faucet");
      await write(index, token, "TestToken", "approve", [stakeManager, parseEther("1000")]);
      await write(index, stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
      await write(index, registry, "AgentRegistry", "register", [BigInt(index)]);
    }
  });

  async function deploy(walletIndex: number, name: string, args: readonly unknown[]) {
    const artifact = artifacts[name];
    const hash = await wallets[walletIndex].deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode, args } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Missing deployment address for ${name}`);
    return receipt.contractAddress;
  }

  async function write(walletIndex: number, address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    const hash = await wallets[walletIndex].writeContract({ address, abi: artifacts[name].abi as Abi, functionName, args } as never);
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function read(functionName: string, args: readonly unknown[] = []) {
    return publicClient.readContract({ address: registry, abi: artifacts.AgentRegistry.abi as Abi, functionName, args } as never);
  }

  it("builds the complete frozen prefix in bounded sequential pages before scheduling entropy", async () => {
    const poolId = keccak256(stringToHex("task-42-round-1-evaluator"));
    await expect(write(0, registry, "AgentRegistry", "startSelectionPool", [poolId, 42n, 4, true])).rejects.toThrow();
    await write(0, requester, "SelectionRequesterHarness", "start", [poolId, 42n, 4, true]);
    let pool = await read("selectionPools", [poolId]) as readonly unknown[];
    expect(pool[2]).toBe(5n);
    expect(pool[3]).toBe(0n);
    expect(pool[5]).toBe(0n);
    expect(pool[12]).toBe(false);
    await expect(write(6, registry, "AgentRegistry", "buildSelectionPool", [poolId, 65])).rejects.toThrow();

    await write(6, registry, "AgentRegistry", "buildSelectionPool", [poolId, 2]);
    pool = await read("selectionPools", [poolId]) as readonly unknown[];
    expect(pool[3]).toBe(2n);
    expect(pool[5]).toBe(0n);
    await write(2, registry, "AgentRegistry", "buildSelectionPool", [poolId, 2]);
    await write(4, registry, "AgentRegistry", "buildSelectionPool", [poolId, 2]);
    pool = await read("selectionPools", [poolId]) as readonly unknown[];
    expect(pool[3]).toBe(5n);
    expect(pool[4]).toBe(30_000n);
    expect(pool[5]).toBeGreaterThan(0n);
    expect(pool[12]).toBe(true);
    for (let index = 0; index < 5; index += 1) {
      const candidate = await read("selectionPoolCandidate", [poolId, BigInt(index)]) as readonly [Address, bigint];
      expect(candidate[0].toLowerCase()).toBe(wallets[index + 1].account!.address.toLowerCase());
      expect(candidate[1]).toBe(6_000n);
    }
  });

  it("draws unique live non-conflicted winners and preserves frozen audit weights", async () => {
    const poolId = keccak256(stringToHex("task-43-round-1-validator"));
    await write(0, requester, "SelectionRequesterHarness", "start", [poolId, 43n, 2, false]);
    await write(1, registry, "AgentRegistry", "buildSelectionPool", [poolId, 5]);
    await write(0, requester, "SelectionRequesterHarness", "setConflict", [43n, wallets[1].account!.address, false, true]);
    await write(2, registry, "AgentRegistry", "setActive", [false]);
    for (let index = 0; index < 6; index += 1) await publicClient.request({ method: "evm_mine" as never });

    for (let attempts = 0; attempts < 8; attempts += 1) {
      const pool = await read("selectionPools", [poolId]) as readonly unknown[];
      if (Number(pool[9]) === 3) break;
      await write(6, requester, "SelectionRequesterHarness", "draw", [poolId, 1]);
    }
    const pool = await read("selectionPools", [poolId]) as readonly unknown[];
    expect(pool[9]).toBe(3);
    const winners = await Promise.all([0, 1, 2].map((slot) => read("selectionPoolWinner", [poolId, slot]) as Promise<Address>));
    expect(new Set(winners.map((winner) => winner.toLowerCase())).size).toBe(3);
    expect(winners.map((winner) => winner.toLowerCase())).not.toContain(wallets[1].account!.address.toLowerCase());
    expect(winners.map((winner) => winner.toLowerCase())).not.toContain(wallets[2].account!.address.toLowerCase());
    for (let index = 0; index < 5; index += 1) {
      const candidate = await read("selectionPoolCandidate", [poolId, BigInt(index)]) as readonly [Address, bigint];
      expect(candidate[1]).toBe(6_000n);
    }
  });
});
