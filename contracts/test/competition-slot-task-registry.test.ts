import ganache from "ganache";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient, createWalletClient, custom, decodeEventLog, defineChain,
  keccak256, parseEther, stringToHex, type Abi, type Address, type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { compileContracts, type ContractArtifact } from "../scripts/compiler";

const mnemonic = "test test test test test test test test test test test junk";
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });
const chain = defineChain({
  id: 31_342, name: "AgentGrid Slot Integration", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});
const authorizationTypes = { CompetitionSlotAuthorization: [
  { name: "publisher", type: "address" }, { name: "taskRegistry", type: "address" },
  { name: "specHash", type: "bytes32" }, { name: "authorizationId", type: "bytes32" },
  { name: "paymentReceiptHash", type: "bytes32" }, { name: "asset", type: "bytes32" },
  { name: "amountAtomic", type: "uint256" }, { name: "issuedAt", type: "uint64" },
  { name: "expiresAt", type: "uint64" }, { name: "paidSlots", type: "uint8" },
  { name: "totalSlots", type: "uint8" },
] } as const;
type Wallet = ReturnType<typeof createWalletClient>;
type Authorization = {
  publisher: Address; taskRegistry: Address; specHash: Hex; authorizationId: Hex; paymentReceiptHash: Hex;
  asset: Hex; amountAtomic: bigint; issuedAt: bigint; expiresAt: bigint; paidSlots: number; totalSlots: number;
};

describe("TaskRegistry competition slot passes", () => {
  let artifacts: Record<string, ContractArtifact>;
  let provider: ReturnType<typeof ganache.provider>;
  let client: ReturnType<typeof createPublicClient>;
  let owner: Wallet; let publisher: Wallet; let issuer: Wallet;
  let addresses: Record<string, Address>;
  let nextPosition: bigint;

  beforeAll(() => { artifacts = compileContracts(); });
  beforeEach(async () => {
    provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: chain.id }, wallet: { mnemonic, totalAccounts: 16, defaultBalance: 1_000 } });
    const transport = custom(provider as never);
    const wallet = (index: number) => createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: index }), chain, transport });
    client = createPublicClient({ chain, transport }); owner = wallet(0); publisher = wallet(1); issuer = wallet(2);
    const token = await deploy(owner, "TestToken", [owner.account!.address]);
    const stake = await deploy(owner, "StakeCreditManager", [token, owner.account!.address]);
    const agents = await deploy(owner, "AgentRegistry", [stake]);
    const vault = await deploy(owner, "RewardVault", [token, wallet(15).account!.address, parseEther("100000"), owner.account!.address]);
    const tasks = await deploy(owner, "TaskRegistry", [stake, vault, agents, owner.account!.address, owner.account!.address]);
    const panel = await deploy(owner, "VerificationPanel", [tasks, vault, agents, owner.account!.address]);
    const economics = await deploy(owner, "ProtocolEconomics", [token, vault, wallet(13).account!.address, wallet(14).account!.address, "0x000000000000000000000000000000000000dEaD", 31_536_000, owner.account!.address]);
    const passes = await deploy(owner, "CompetitionSlotPassRegistry", [tasks, issuer.account!.address, owner.account!.address]);
    addresses = { token, stake, agents, vault, tasks, panel, economics, passes };
    await write(owner, stake, "StakeCreditManager", "setTaskRegistry", [tasks]);
    await write(owner, vault, "RewardVault", "setTaskRegistry", [tasks]);
    await write(owner, tasks, "TaskRegistry", "setVerificationPanel", [panel]);
    await write(owner, vault, "RewardVault", "setVerificationPanel", [panel]);
    await write(owner, economics, "ProtocolEconomics", "configureProtocol", [tasks, stake]);
    await write(owner, stake, "StakeCreditManager", "setProtocolEconomics", [economics]);
    await write(owner, vault, "RewardVault", "setProtocolEconomics", [economics]);
    await write(owner, tasks, "TaskRegistry", "setProtocolEconomics", [economics]);
    await write(owner, agents, "AgentRegistry", "setSelectionRequester", [tasks]);
    await write(owner, tasks, "TaskRegistry", "setCompetitionSlotPassRegistry", [passes]);
    for (let index = 3; index < 6; index += 1) await registerAgent(wallet(index), BigInt(index - 2));
    await write(publisher, token, "TestToken", "faucet");
    await write(publisher, token, "TestToken", "approve", [stake, parseEther("10000")]);
    nextPosition = 4n;
  });

  async function deploy(wallet: Wallet, name: string, args: readonly unknown[]) {
    const hash = await wallet.deployContract({ abi: artifacts[name].abi as Abi, bytecode: artifacts[name].bytecode, args } as never);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Missing ${name} deployment`);
    return receipt.contractAddress;
  }
  async function write(wallet: Wallet, address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    const hash = await wallet.writeContract({ address, abi: artifacts[name].abi as Abi, functionName, args } as never);
    return client.waitForTransactionReceipt({ hash });
  }
  async function registerAgent(wallet: Wallet, positionId: bigint) {
    await write(wallet, addresses.token, "TestToken", "faucet");
    await write(wallet, addresses.token, "TestToken", "approve", [addresses.stake, parseEther("1000")]);
    await write(wallet, addresses.stake, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(wallet, addresses.agents, "AgentRegistry", "register", [positionId]);
  }
  async function publisherPosition(issueCredit = true) {
    await write(publisher, addresses.stake, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    const id = nextPosition++;
    if (issueCredit) await write(publisher, addresses.stake, "StakeCreditManager", "issueCredit", [id]);
    return id;
  }
  function slots(receipt: Awaited<ReturnType<typeof write>>) {
    for (const log of receipt.logs) try {
      const decoded = decodeEventLog({ abi: artifacts.TaskRegistry.abi as Abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "ExecutorSlotsFrozen") return decoded.args as Record<string, unknown>;
    } catch { /* another contract's log */ }
    throw new Error("ExecutorSlotsFrozen missing");
  }
  async function auth(specHash: Hex, totalSlots: number, suffix: string, publisherAddress = publisher.account!.address): Promise<Authorization> {
    const now = (await client.getBlock()).timestamp;
    return { publisher: publisherAddress, taskRegistry: addresses.tasks, specHash,
      authorizationId: keccak256(stringToHex(`auth-${suffix}`)), paymentReceiptHash: keccak256(stringToHex(`receipt-${suffix}`)),
      asset: keccak256(stringToHex("USDT")), amountAtomic: BigInt(totalSlots - 2) * 10_000_000n,
      issuedAt: now, expiresAt: now + 3_600n, paidSlots: totalSlots - 2, totalSlots };
  }
  async function register(input: Authorization) {
    const signature = await issuer.signTypedData({ account: issuer.account!, domain: { name: "AgentGrid Competition Slot Pass", version: "1", chainId: chain.id, verifyingContract: addresses.passes }, types: authorizationTypes, primaryType: "CompetitionSlotAuthorization", message: input });
    await write(owner, addresses.passes, "CompetitionSlotPassRegistry", "registerAuthorization", [input, signature]);
  }
  async function create(positionId: bigint, spec: Hex, total: number, mode: number, reward = parseEther("777")) {
    return write(publisher, addresses.tasks, "TaskRegistry", "createTaskWithMode", [positionId, spec, reward, total, mode]);
  }

  it("keeps two competition slots free and never charges collaboration slots", async () => {
    const freeSpec = keccak256(stringToHex("free-two"));
    const free = slots(await create(await publisherPosition(), freeSpec, 2, 1));
    expect(free).toMatchObject({ includedSlots: 2, paidExtraSlots: 0, totalSlots: 2 });
    await expect(create(await publisherPosition(), keccak256(stringToHex("unpaid-three")), 3, 1)).rejects.toThrow();
    const collaboration = slots(await create(await publisherPosition(), keccak256(stringToHex("collab-32")), 32, 0));
    expect(collaboration).toMatchObject({ includedSlots: 32, paidExtraSlots: 0, totalSlots: 32 });
  });

  it("consumes exact paid authorizations for 3..32 slots without changing requestedReward", async () => {
    let evaluationFee: bigint | undefined;
    for (const total of [3, 32]) {
      const spec = keccak256(stringToHex(`paid-${total}`)); const input = await auth(spec, total, `${total}`); await register(input);
      const event = slots(await create(await publisherPosition(), spec, total, 1));
      expect(event).toMatchObject({ includedSlots: 2, paidExtraSlots: total - 2, totalSlots: total, authorizationId: input.authorizationId, paymentReceiptHash: input.paymentReceiptHash });
      const task = await client.readContract({ address: addresses.tasks, abi: artifacts.TaskRegistry.abi as Abi, functionName: "tasks", args: [BigInt(total === 3 ? 1 : 2)] }) as readonly unknown[];
      expect(task[4]).toBe(parseEther("777"));
      const currentEvaluationFee = await client.readContract({ address: addresses.vault, abi: artifacts.RewardVault.abi as Abi, functionName: "evaluationFees", args: [BigInt(total === 3 ? 1 : 2)] }) as bigint;
      expect(currentEvaluationFee).toBeGreaterThan(0n);
      if (evaluationFee === undefined) evaluationFee = currentEvaluationFee;
      else expect(currentEvaluationFee).toBe(evaluationFee);
      await expect(create(await publisherPosition(), spec, total, 1)).rejects.toThrow();
    }
  });

  it("rejects publisher/spec mismatches and restores a consumed pass when downstream creation reverts", async () => {
    const wrongSpec = keccak256(stringToHex("wrong-spec")); const expectedSpec = keccak256(stringToHex("expected-spec"));
    await register(await auth(expectedSpec, 3, "mismatch"));
    await expect(create(await publisherPosition(), wrongSpec, 3, 1)).rejects.toThrow();
    const wrongPublisherSpec = keccak256(stringToHex("wrong-publisher"));
    await register(await auth(wrongPublisherSpec, 3, "wrong-publisher", owner.account!.address));
    await expect(create(await publisherPosition(), wrongPublisherSpec, 3, 1)).rejects.toThrow();
    const rollbackSpec = keccak256(stringToHex("rollback")); const rollback = await auth(rollbackSpec, 3, "rollback"); await register(rollback);
    const position = await publisherPosition(false);
    await expect(create(position, rollbackSpec, 3, 1)).rejects.toThrow();
    await write(publisher, addresses.stake, "StakeCreditManager", "issueCredit", [position]);
    const event = slots(await create(position, rollbackSpec, 3, 1));
    expect(event.authorizationId).toBe(rollback.authorizationId);
  });
});
