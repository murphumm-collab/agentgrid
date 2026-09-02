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
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const chain = defineChain({
  id: 31_338,
  name: "AgentGrid Quality Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

describe("AgentRegistry role quality", () => {
  let artifacts: Record<string, ContractArtifact>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let owner: ReturnType<typeof createWalletClient>;
  let agent: ReturnType<typeof createWalletClient>;
  let outsider: ReturnType<typeof createWalletClient>;
  let token: Address;
  let stakeManager: Address;
  let agentRegistry: Address;
  let qualityReporter: Address;

  beforeAll(() => {
    artifacts = compileContracts();
    const fixtureName = "QualityReporterHarness.sol";
    const input = {
      language: "Solidity",
      sources: { [fixtureName]: { content: readFileSync(path.resolve(process.cwd(), "contracts/test/fixtures", fixtureName), "utf8") } },
      settings: { optimizer: { enabled: true, runs: 1 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const fixture = output.contracts[fixtureName].QualityReporterHarness;
    artifacts.QualityReporterHarness = {
      abi: fixture.abi, bytecode: `0x${fixture.evm.bytecode.object}`,
      deployedBytecode: `0x${fixture.evm.deployedBytecode.object}`, immutableReferences: [],
    };
  });

  beforeEach(async () => {
    const provider = ganache.provider({
      logging: { quiet: true }, chain: { chainId: chain.id },
      wallet: { mnemonic, totalAccounts: 4, defaultBalance: 1_000 },
    });
    const transport = custom(provider as never);
    publicClient = createPublicClient({ chain, transport });
    owner = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 0 }), chain, transport });
    agent = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 1 }), chain, transport });
    outsider = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 2 }), chain, transport });
    token = await deploy(owner, "TestToken", [owner.account!.address]);
    stakeManager = await deploy(owner, "StakeCreditManager", [token, owner.account!.address]);
    agentRegistry = await deploy(owner, "AgentRegistry", [stakeManager]);
    qualityReporter = await deploy(owner, "QualityReporterHarness", [agentRegistry]);
    await write(agent, token, "TestToken", "faucet");
    await write(agent, token, "TestToken", "approve", [stakeManager, parseEther("1000")]);
    await write(agent, stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(agent, agentRegistry, "AgentRegistry", "register", [1n]);
    await write(owner, agentRegistry, "AgentRegistry", "setOutcomeReporter", [qualityReporter, 7]);
  });

  async function deploy(wallet: ReturnType<typeof createWalletClient>, name: string, args: readonly unknown[]) {
    const artifact = artifacts[name];
    const hash = await wallet.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode, args } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Missing deployment address for ${name}`);
    return receipt.contractAddress;
  }

  async function write(wallet: ReturnType<typeof createWalletClient>, address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    const hash = await wallet.writeContract({ address, abi: artifacts[name].abi as Abi, functionName, args } as never);
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function read(name: string, functionName: string, args: readonly unknown[] = []) {
    return publicClient.readContract({ address: agentRegistry, abi: artifacts[name].abi as Abi, functionName, args } as never);
  }

  const publisher = (index: number) => mnemonicToAccount(mnemonic, { addressIndex: index + 10 }).address;

  it("allows only pure executors to register without stake and keeps quality gates enforceable", async () => {
    await expect(write(outsider, agentRegistry, "AgentRegistry", "registerWithCapabilities", [0n, 2])).rejects.toThrow();
    await expect(write(outsider, agentRegistry, "AgentRegistry", "registerWithCapabilities", [0n, 4])).rejects.toThrow();
    await expect(write(outsider, agentRegistry, "AgentRegistry", "registerWithCapabilities", [0n, 7])).rejects.toThrow();

    const selectionVersionBefore = await read("AgentRegistry", "registryVersion");
    const selectionCountBefore = await read("AgentRegistry", "agentCount");
    await write(outsider, agentRegistry, "AgentRegistry", "registerWithCapabilities", [0n, 1]);
    expect(await read("AgentRegistry", "agentPosition", [outsider.account!.address])).toBe(0n);
    expect(await read("AgentRegistry", "isEligible", [outsider.account!.address])).toBe(false);
    expect(await read("AgentRegistry", "isEligibleFor", [outsider.account!.address, 1])).toBe(true);
    expect(await read("AgentRegistry", "isEligibleFor", [outsider.account!.address, 2])).toBe(false);
    expect(await read("AgentRegistry", "registryVersion")).toBe(selectionVersionBefore);
    expect(await read("AgentRegistry", "agentCount")).toBe(selectionCountBefore);
    const version = await read("AgentRegistry", "registryVersion");
    await write(outsider, agentRegistry, "AgentRegistry", "registerWithCapabilities", [0n, 1]);
    expect(await read("AgentRegistry", "registryVersion")).toBe(version);

    await write(outsider, agentRegistry, "AgentRegistry", "setActive", [false]);
    expect(await read("AgentRegistry", "isEligibleFor", [outsider.account!.address, 1])).toBe(false);
    await write(outsider, agentRegistry, "AgentRegistry", "setActive", [true]);
    for (let index = 0; index < 6; index += 1) await write(owner, qualityReporter, "QualityReporterHarness", "record", [
      outsider.account!.address, 1, keccak256(stringToHex(`executor-failure-${index}`)),
      keccak256(stringToHex("EXECUTION_FAILED")), false, false,
      keccak256(stringToHex(`executor-failure-evidence-${index}`)),
    ]);
    expect(await read("AgentRegistry", "isEligibleFor", [outsider.account!.address, 1])).toBe(false);

    await write(outsider, token, "TestToken", "faucet");
    await write(outsider, token, "TestToken", "approve", [stakeManager, parseEther("1000")]);
    await write(outsider, stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(outsider, agentRegistry, "AgentRegistry", "registerWithCapabilities", [2n, 7]);
    expect(await read("AgentRegistry", "agentCount")).toBe((selectionCountBefore as bigint) + 1n);
    expect(await read("AgentRegistry", "isEligibleFor", [outsider.account!.address, 2])).toBe(true);
  });

  it("starts neutral, rewards proven outcomes and keeps role scores isolated", async () => {
    const initial = await read("AgentRegistry", "qualityOf", [agent.account!.address, 2]) as { scoreBps: number; outcomeCount: number };
    expect(initial.scoreBps).toBe(5_000);
    expect(await read("AgentRegistry", "selectionWeight", [agent.account!.address, 2])).toBe(6_000n);

    await write(owner, qualityReporter, "QualityReporterHarness", "recordTask", [
      agent.account!.address, 2, 1n, publisher(1), parseEther("100"), keccak256(stringToHex("task-1-panel-1")), keccak256(stringToHex("VERIFICATION_COMPLETED")), true, false, keccak256(stringToHex("verified-success")),
    ]);
    const improved = await read("AgentRegistry", "qualityOf", [agent.account!.address, 2]) as { scoreBps: number; outcomeCount: number };
    expect(improved.scoreBps).toBe(5_200);
    expect(improved.outcomeCount).toBe(1);
    expect(await read("AgentRegistry", "qualityMultiplierBps", [agent.account!.address, 2])).toBe(10_000);
    expect(await read("AgentRegistry", "selectionWeight", [agent.account!.address, 2])).toBe(6_000n);
    for (let index = 2; index <= 3; index += 1) await write(owner, qualityReporter, "QualityReporterHarness", "recordTask", [
      agent.account!.address, 2, BigInt(index), publisher(index), parseEther("100"), keccak256(stringToHex(`task-${index}-panel-1`)), keccak256(stringToHex("VERIFICATION_COMPLETED")), true, false, keccak256(stringToHex(`verified-success-${index}`)),
    ]);
    expect(await read("AgentRegistry", "qualityMultiplierBps", [agent.account!.address, 2])).toBe(10_240);
    expect(await read("AgentRegistry", "selectionWeight", [agent.account!.address, 2])).toBe(6_600n);
    const executorQuality = await read("AgentRegistry", "qualityOf", [agent.account!.address, 1]) as { scoreBps: number; outcomeCount: number };
    expect(executorQuality.scoreBps).toBe(5_000);
    expect(executorQuality.outcomeCount).toBe(0);
  });

  it("cools down low-quality roles, bans three severe faults and requires an evidence-bound appeal", async () => {
    for (let index = 0; index < 3; index += 1) {
      await write(owner, qualityReporter, "QualityReporterHarness", "record", [
        agent.account!.address, 2, keccak256(stringToHex(`task-${index}-panel-1`)), keccak256(stringToHex("UPHELD_CHALLENGE")), false, true, keccak256(stringToHex(`upheld-fault-${index}`)),
      ]);
    }
    const banned = await read("AgentRegistry", "qualityOf", [agent.account!.address, 2]) as { scoreBps: number; severeFaults: number; banned: boolean };
    expect(banned.scoreBps).toBe(500);
    expect(banned.severeFaults).toBe(3);
    expect(banned.banned).toBe(true);
    expect(await read("AgentRegistry", "isEligibleFor", [agent.account!.address, 2])).toBe(false);
    expect(await read("AgentRegistry", "isEligibleFor", [agent.account!.address, 1])).toBe(true);

    await expect(write(owner, agentRegistry, "AgentRegistry", "rehabilitateRole", [
      agent.account!.address, 2, keccak256(stringToHex("appeal")),
    ])).rejects.toThrow();
    await write(owner, qualityReporter, "QualityReporterHarness", "rehabilitate", [
      agent.account!.address, 2, keccak256(stringToHex("appeal-upheld")),
    ]);
    const restored = await read("AgentRegistry", "qualityOf", [agent.account!.address, 2]) as { scoreBps: number; severeFaults: number; cooldownUntil: bigint; banned: boolean };
    expect(restored.scoreBps).toBe(2_500);
    expect(restored.severeFaults).toBe(2);
    expect(restored.cooldownUntil).toBe(0n);
    expect(restored.banned).toBe(false);
    expect(await read("AgentRegistry", "isEligibleFor", [agent.account!.address, 2])).toBe(true);
    expect(await read("AgentRegistry", "selectionWeight", [agent.account!.address, 2])).toBe(3_500n);
  });

  it("rejects forged and replayed outcomes while consuming post-ban evidence without blocking", async () => {
    const context = keccak256(stringToHex("task-9-panel-1"));
    const outcomeType = keccak256(stringToHex("VERIFICATION_COMPLETED"));
    const evidence = keccak256(stringToHex("canonical-evidence"));
    await expect(write(outsider, agentRegistry, "AgentRegistry", "recordOutcome", [
      agent.account!.address, 2, context, outcomeType, true, false, evidence,
    ])).rejects.toThrow();
    await expect(write(owner, agentRegistry, "AgentRegistry", "setOutcomeReporter", [outsider.account!.address, 2])).rejects.toThrow();
    await write(owner, qualityReporter, "QualityReporterHarness", "record", [agent.account!.address, 2, context, outcomeType, true, false, evidence]);
    expect(await read("AgentRegistry", "independentPositiveOutcomeCount", [agent.account!.address, 2])).toBe(0);
    expect((await read("AgentRegistry", "qualityOf", [agent.account!.address, 2]) as { scoreBps: number }).scoreBps).toBe(5_000);
    await expect(write(owner, qualityReporter, "QualityReporterHarness", "record", [
      agent.account!.address, 2, context, outcomeType, false, true, keccak256(stringToHex("changed-evidence")),
    ])).rejects.toThrow();

    for (let index = 0; index < 3; index += 1) await write(owner, qualityReporter, "QualityReporterHarness", "record", [
      agent.account!.address, 2, keccak256(stringToHex(`ban-context-${index}`)), keccak256(stringToHex("UPHELD_CHALLENGE")), false, true, keccak256(stringToHex(`ban-evidence-${index}`)),
    ]);
    const beforeIgnored = await read("AgentRegistry", "qualityOf", [agent.account!.address, 2]) as { outcomeCount: number };
    await write(owner, qualityReporter, "QualityReporterHarness", "record", [
      agent.account!.address, 2, keccak256(stringToHex("parallel-panel")), outcomeType, true, false, keccak256(stringToHex("parallel-evidence")),
    ]);
    const afterIgnored = await read("AgentRegistry", "qualityOf", [agent.account!.address, 2]) as { outcomeCount: number };
    expect(afterIgnored.outcomeCount).toBe(beforeIgnored.outcomeCount);
  });

  it("withholds gains from tiny, self-dealing and repeated publisher relationships without suppressing failures", async () => {
    const outcomeType = keccak256(stringToHex("EXECUTION_VERIFIED"));
    const relationPublisher = publisher(40);
    await write(owner, qualityReporter, "QualityReporterHarness", "recordTask", [
      agent.account!.address, 1, 1n, relationPublisher, parseEther("9.99"), keccak256(stringToHex("tiny-task")), outcomeType, true, false, keccak256(stringToHex("tiny-evidence")),
    ]);
    await write(owner, qualityReporter, "QualityReporterHarness", "recordTask", [
      agent.account!.address, 1, 2n, agent.account!.address, parseEther("100"), keccak256(stringToHex("self-task")), outcomeType, true, false, keccak256(stringToHex("self-evidence")),
    ]);
    expect(await read("AgentRegistry", "independentPositiveOutcomeCount", [agent.account!.address, 1])).toBe(0);
    expect((await read("AgentRegistry", "qualityOf", [agent.account!.address, 1]) as { scoreBps: number }).scoreBps).toBe(5_000);

    await write(owner, qualityReporter, "QualityReporterHarness", "recordTask", [
      agent.account!.address, 1, 3n, relationPublisher, parseEther("100"), keccak256(stringToHex("valid-task")), outcomeType, true, false, keccak256(stringToHex("valid-evidence")),
    ]);
    await write(owner, qualityReporter, "QualityReporterHarness", "recordTask", [
      agent.account!.address, 1, 4n, relationPublisher, parseEther("100"), keccak256(stringToHex("repeat-task")), outcomeType, true, false, keccak256(stringToHex("repeat-evidence")),
    ]);
    expect(await read("AgentRegistry", "independentPositiveOutcomeCount", [agent.account!.address, 1])).toBe(1);
    expect((await read("AgentRegistry", "qualityOf", [agent.account!.address, 1]) as { scoreBps: number; outcomeCount: number })).toMatchObject({ scoreBps: 5_200, outcomeCount: 4 });
    expect(await read("AgentRegistry", "selectionWeight", [agent.account!.address, 1])).toBe(6_000n);

    await write(owner, qualityReporter, "QualityReporterHarness", "recordTask", [
      agent.account!.address, 1, 5n, relationPublisher, parseEther("1"), keccak256(stringToHex("failed-tiny-task")), keccak256(stringToHex("EXECUTION_FAILED")), false, false, keccak256(stringToHex("failed-evidence")),
    ]);
    expect((await read("AgentRegistry", "qualityOf", [agent.account!.address, 1]) as { scoreBps: number }).scoreBps).toBe(4_700);
  });

  it("caps positive score gains per role and epoch without replaying or inflating rewards", async () => {
    for (let index = 0; index < 12; index += 1) await write(owner, qualityReporter, "QualityReporterHarness", "recordTask", [
      agent.account!.address, 1, BigInt(index + 1), publisher(index), parseEther("100"), keccak256(stringToHex(`executor-task-${index}`)),
      keccak256(stringToHex("EXECUTION_VERIFIED")), true, false,
      keccak256(stringToHex(`executor-evidence-${index}`)),
    ]);
    const quality = await read("AgentRegistry", "qualityOf", [agent.account!.address, 1]) as { scoreBps: number; outcomeCount: number };
    expect(quality).toMatchObject({ scoreBps: 7_000, outcomeCount: 12 });
    expect(await read("AgentRegistry", "qualityMultiplierBps", [agent.account!.address, 1])).toBe(10_800);
  });

  it("freezes request-time selection weight while retaining current safety vetoes", async () => {
    const snapshotVersion = await read("AgentRegistry", "registryVersion") as bigint;
    const snapshotTime = (await publicClient.getBlock()).timestamp;
    expect(await read("AgentRegistry", "selectionWeightAt", [
      agent.account!.address, 2, snapshotVersion, snapshotTime,
    ])).toBe(6_000n);
    expect(await read("AgentRegistry", "frozenSelectionWeightAt", [
      agent.account!.address, 2, snapshotVersion, snapshotTime,
    ])).toBe(6_000n);

    for (let index = 0; index < 3; index += 1) await write(owner, qualityReporter, "QualityReporterHarness", "recordTask", [
      agent.account!.address, 2, BigInt(index + 1), publisher(index), parseEther("100"), keccak256(stringToHex(`snapshot-success-${index}`)),
      keccak256(stringToHex("VERIFICATION_COMPLETED")), true, false,
      keccak256(stringToHex(`snapshot-evidence-${index}`)),
    ]);
    expect(await read("AgentRegistry", "selectionWeight", [agent.account!.address, 2])).toBe(6_600n);
    expect(await read("AgentRegistry", "selectionWeightAt", [
      agent.account!.address, 2, snapshotVersion, snapshotTime,
    ])).toBe(6_000n);

    await write(agent, agentRegistry, "AgentRegistry", "setActive", [false]);
    expect(await read("AgentRegistry", "selectionWeightAt", [
      agent.account!.address, 2, snapshotVersion, snapshotTime,
    ])).toBe(0n);
    expect(await read("AgentRegistry", "frozenSelectionWeightAt", [
      agent.account!.address, 2, snapshotVersion, snapshotTime,
    ])).toBe(6_000n);
    await write(agent, agentRegistry, "AgentRegistry", "setActive", [true]);
    expect(await read("AgentRegistry", "selectionWeightAt", [
      agent.account!.address, 2, snapshotVersion, snapshotTime,
    ])).toBe(6_000n);

    await write(agent, agentRegistry, "AgentRegistry", "registerWithCapabilities", [1n, 5]);
    const noTestVersion = await read("AgentRegistry", "registryVersion") as bigint;
    const noTestTime = (await publicClient.getBlock()).timestamp;
    expect(await read("AgentRegistry", "selectionWeightAt", [
      agent.account!.address, 2, snapshotVersion, snapshotTime,
    ])).toBe(0n);
    await write(agent, agentRegistry, "AgentRegistry", "registerWithCapabilities", [1n, 7]);
    expect(await read("AgentRegistry", "selectionWeightAt", [
      agent.account!.address, 2, noTestVersion, noTestTime,
    ])).toBe(0n);
    expect(await read("AgentRegistry", "frozenSelectionWeightAt", [
      agent.account!.address, 2, noTestVersion, noTestTime,
    ])).toBe(0n);
    await write(agent, stakeManager, "StakeCreditManager", "requestWithdrawal", [1n]);
    expect(await read("AgentRegistry", "selectionWeightAt", [
      agent.account!.address, 2, snapshotVersion, snapshotTime,
    ])).toBe(0n);
    expect(await read("AgentRegistry", "frozenSelectionWeightAt", [
      agent.account!.address, 2, snapshotVersion, snapshotTime,
    ])).toBe(6_000n);
  });
});
