import ganache from "ganache";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient, createWalletClient, custom, defineChain, keccak256,
  parseEther, stringToHex, type Abi, type Address,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { compileContracts, type ContractArtifact } from "../scripts/compiler";

const mnemonic = "test test test test test test test test test test test junk";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const chain = defineChain({
  id: 31_339,
  name: "AgentGrid Economics Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

describe("ProtocolEconomics", () => {
  let artifacts: Record<string, ContractArtifact>;
  let provider: ReturnType<typeof ganache.provider>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let owner: ReturnType<typeof createWalletClient>;
  let registry: ReturnType<typeof createWalletClient>;
  let stakeManager: ReturnType<typeof createWalletClient>;
  let vault: ReturnType<typeof createWalletClient>;
  let source: ReturnType<typeof createWalletClient>;
  let publisher: ReturnType<typeof createWalletClient>;
  let daoWallet: ReturnType<typeof createWalletClient>;
  let dao: Address;
  let security: Address;
  let burn: Address;
  let token: Address;
  let economics: Address;

  beforeAll(() => { artifacts = compileContracts(); });

  beforeEach(async () => {
    provider = ganache.provider({
      logging: { quiet: true }, chain: { chainId: chain.id },
      wallet: { mnemonic, totalAccounts: 10, defaultBalance: 1_000 },
    });
    const transport = custom(provider as never);
    publicClient = createPublicClient({ chain, transport });
    const wallet = (index: number) => createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: index }), chain, transport });
    owner = wallet(0); registry = wallet(1); stakeManager = wallet(2); vault = wallet(3);
    source = wallet(4); publisher = wallet(5);
    daoWallet = wallet(6); dao = daoWallet.account!.address; security = wallet(7).account!.address;
    burn = "0x000000000000000000000000000000000000dEaD";
    token = await deploy("TestToken", [owner.account!.address]);
    economics = await deploy("ProtocolEconomics", [
      token, vault.account!.address, dao, security, burn, 365 * 24 * 60 * 60, owner.account!.address,
    ]);
    await write(owner, economics, "ProtocolEconomics", "configureProtocol", [registry.account!.address, stakeManager.account!.address]);
    for (const funder of [stakeManager, vault]) {
      await write(funder, token, "TestToken", "faucet");
      await write(funder, token, "TestToken", "approve", [economics, parseEther("10000")]);
    }
  });

  async function deploy(name: string, args: readonly unknown[]) {
    const artifact = artifacts[name];
    const hash = await owner.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode, args } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Missing deployment address for ${name}`);
    return receipt.contractAddress;
  }

  async function write(wallet: ReturnType<typeof createWalletClient>, address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    const hash = await wallet.writeContract({ address, abi: artifacts[name].abi as Abi, functionName, args } as never);
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function read(address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    return publicClient.readContract({ address, abi: artifacts[name].abi as Abi, functionName, args } as never);
  }

  const sourceId = keccak256(stringToHex("official-frontend"));

  it("freezes a valid source and rejects replacement while self-referrals fall back to DAO", async () => {
    await write(owner, economics, "ProtocolEconomics", "configureSource", [sourceId, source.account!.address, true]);
    await write(publisher, economics, "ProtocolEconomics", "commitNextTaskSource", [sourceId]);
    await write(registry, economics, "ProtocolEconomics", "freezeTaskSource", [1n, publisher.account!.address]);
    const frozen = await read(economics, "ProtocolEconomics", "taskSources", [1n]) as readonly [Address, Address, bigint];
    expect(frozen[0]).toBe(sourceId);
    expect(frozen[1]).toBe(source.account!.address);
    await expect(write(registry, economics, "ProtocolEconomics", "freezeTaskSource", [1n, publisher.account!.address])).rejects.toThrow();

    await write(owner, economics, "ProtocolEconomics", "configureSource", [sourceId, publisher.account!.address, true]);
    await write(publisher, economics, "ProtocolEconomics", "commitNextTaskSource", [sourceId]);
    await write(registry, economics, "ProtocolEconomics", "freezeTaskSource", [2n, publisher.account!.address]);
    const fallback = await read(economics, "ProtocolEconomics", "taskSources", [2n]) as readonly [Address, Address, bigint];
    expect(fallback[0]).toBe(`0x${"0".repeat(64)}`);
    expect(fallback[1]).toBe(dao);
  });

  it("routes each lifecycle stage once, totals 1.5%, and assigns all rounding dust to RewardVault", async () => {
    await write(owner, economics, "ProtocolEconomics", "configureSource", [sourceId, source.account!.address, true]);
    await write(publisher, economics, "ProtocolEconomics", "commitNextTaskSource", [sourceId]);
    await write(registry, economics, "ProtocolEconomics", "freezeTaskSource", [7n, publisher.account!.address]);
    const basis = parseEther("1000");
    const expectedCharges = [parseEther("2"), parseEther("3"), parseEther("7"), parseEther("3")];
    for (let stage = 0; stage < 4; stage += 1) {
      await write(stakeManager, economics, "ProtocolEconomics", "routeLifecycleCharge", [7n, stage, basis, expectedCharges[stage]]);
    }
    expect(await read(economics, "ProtocolEconomics", "consumedLifecycleStages", [7n])).toBe(15);
    expect(await read(token, "TestToken", "balanceOf", [vault.account!.address])).toBe(parseEther("10005.25"));
    expect(await read(token, "TestToken", "balanceOf", [burn])).toBe(parseEther("3"));
    expect(await read(token, "TestToken", "balanceOf", [dao])).toBe(0n);
    expect(await read(token, "TestToken", "balanceOf", [security])).toBe(parseEther("1.5"));
    expect(await read(token, "TestToken", "balanceOf", [economics])).toBe(parseEther("5.25"));
    await expect(write(stakeManager, economics, "ProtocolEconomics", "routeLifecycleCharge", [7n, 0, basis, expectedCharges[0]])).rejects.toThrow();
  });

  it("splits gross rewards 95/3/2 and keeps every source allocation locked for 365 days", async () => {
    await write(owner, economics, "ProtocolEconomics", "configureSource", [sourceId, source.account!.address, true]);
    await write(publisher, economics, "ProtocolEconomics", "commitNextTaskSource", [sourceId]);
    await write(registry, economics, "ProtocolEconomics", "freezeTaskSource", [9n, publisher.account!.address]);
    const gross = 10_001n;
    await write(vault, economics, "ProtocolEconomics", "routeTaskReward", [9n, gross, 500n]);
    const vestingId = keccak256(stringToHex("placeholder"));
    const logs = await publicClient.getContractEvents({
      address: economics, abi: artifacts.ProtocolEconomics.abi as Abi,
      eventName: "TaskRewardRouted", fromBlock: 0n,
    } as never) as Array<{ args: { agentPool: bigint; daoAmount: bigint; sourceAmount: bigint; daoVestingId: Address; sourceVestingId: Address } }>;
    expect(logs.at(-1)?.args.agentPool).toBe(9_501n);
    expect(logs.at(-1)?.args.daoAmount).toBe(300n);
    expect(logs.at(-1)?.args.sourceAmount).toBe(200n);
    const id = logs.at(-1)?.args.sourceVestingId ?? vestingId;
    const daoId = logs.at(-1)?.args.daoVestingId ?? vestingId;
    await expect(write(daoWallet, economics, "ProtocolEconomics", "claimVesting", [daoId])).rejects.toThrow();
    await expect(write(source, economics, "ProtocolEconomics", "claimVesting", [id])).rejects.toThrow();
    await provider.request({ method: "evm_increaseTime", params: [365 * 24 * 60 * 60] });
    await provider.request({ method: "evm_mine", params: [] });
    await write(source, economics, "ProtocolEconomics", "claimVesting", [id]);
    await write(daoWallet, economics, "ProtocolEconomics", "claimVesting", [daoId]);
    expect(await read(token, "TestToken", "balanceOf", [source.account!.address])).toBe(200n);
    expect(await read(token, "TestToken", "balanceOf", [dao])).toBe(300n);
    await expect(write(source, economics, "ProtocolEconomics", "claimVesting", [id])).rejects.toThrow();
    await expect(write(vault, economics, "ProtocolEconomics", "routeTaskReward", [9n, gross, 500n])).rejects.toThrow();
  });

  it("keeps RewardVault and router rounding identical for sub-basis-point grants", async () => {
    const rewardVault = await deploy("RewardVault", [token, security, parseEther("100000"), owner.account!.address]);
    const router = await deploy("ProtocolEconomics", [
      token, rewardVault, dao, security, burn, 365 * 24 * 60 * 60, owner.account!.address,
    ]);
    await write(owner, router, "ProtocolEconomics", "configureProtocol", [owner.account!.address, stakeManager.account!.address]);
    await write(owner, rewardVault, "RewardVault", "setTaskRegistry", [owner.account!.address]);
    await write(owner, rewardVault, "RewardVault", "setProtocolEconomics", [router]);
    await write(owner, token, "TestToken", "mintRewardReserve", [rewardVault, 20n]);
    await write(owner, router, "ProtocolEconomics", "freezeTaskSource", [77n, publisher.account!.address]);
    await write(owner, rewardVault, "RewardVault", "createGrant", [
      77n, [publisher.account!.address], [10_000], source.account!.address,
      keccak256(stringToHex("tiny-grant")), 20n, parseEther("1000"),
    ]);
    const grant = await read(rewardVault, "RewardVault", "getGrant", [77n]) as { total: bigint };
    expect(grant.total).toBe(20n);
    expect(await read(router, "ProtocolEconomics", "taskRewardRouted", [77n])).toBe(true);
  });
});
