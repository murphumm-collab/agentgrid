import ganache from "ganache";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeAbiParameters,
  keccak256,
  parseEther,
  stringToHex,
  type Abi,
  type Address,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { compileContracts, type ContractArtifact } from "../scripts/compiler";
import { verifyRuntimeBytecode } from "../scripts/bytecode-verification";

const mnemonic = "test test test test test test test test test test test junk";
// Ganache falls back to its pure-JavaScript engine on some Node/ARM builds. The
// lifecycle cases intentionally deploy the full protocol and can exceed one
// minute there even though the same assertions finish much faster with native
// bindings.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const localChain = defineChain({
  id: 31_337,
  name: "AgentGrid Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

type Wallet = ReturnType<typeof createWalletClient>;

describe("AgentGrid Solidity protocol", () => {
  let artifacts: Record<string, ContractArtifact>;
  let provider: ReturnType<typeof ganache.provider>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let owner: Wallet;
  let publisher: Wallet;
  let executor: Wallet;
  let tester: Wallet;
  let reserveAccount: ReturnType<typeof mnemonicToAccount>;
  let addresses: Record<"token" | "stakeManager" | "agentRegistry" | "rewardVault" | "taskRegistry", Address>;

  beforeAll(() => {
    artifacts = compileContracts();
  });

  beforeEach(async () => {
    provider = ganache.provider({
      logging: { quiet: true },
      chain: { chainId: localChain.id },
      wallet: { mnemonic, totalAccounts: 10, defaultBalance: 1_000 },
    });
    const transport = custom(provider as never);
    publicClient = createPublicClient({ chain: localChain, transport });
    owner = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 0 }), chain: localChain, transport });
    publisher = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 1 }), chain: localChain, transport });
    executor = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 2 }), chain: localChain, transport });
    tester = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 3 }), chain: localChain, transport });
    reserveAccount = mnemonicToAccount(mnemonic, { addressIndex: 4 });

    const ownerAddress = owner.account!.address;
    const token = await deploy(owner, "TestToken", [ownerAddress]);
    const stakeManager = await deploy(owner, "StakeCreditManager", [token, ownerAddress]);
    const agentRegistry = await deploy(owner, "AgentRegistry", [stakeManager]);
    const rewardVault = await deploy(owner, "RewardVault", [token, reserveAccount.address, parseEther("100000"), ownerAddress]);
    const taskRegistry = await deploy(owner, "TaskRegistry", [stakeManager, rewardVault, agentRegistry, ownerAddress, ownerAddress]);
    addresses = { token, stakeManager, agentRegistry, rewardVault, taskRegistry };

    for (const [name, address] of Object.entries(addresses)) {
      const artifactName = ({ token: "TestToken", stakeManager: "StakeCreditManager", agentRegistry: "AgentRegistry", rewardVault: "RewardVault", taskRegistry: "TaskRegistry" } as const)[name as keyof typeof addresses];
      verifyRuntimeBytecode(name, await publicClient.getCode({ address }), artifacts[artifactName]);
    }

    await write(owner, stakeManager, "StakeCreditManager", "setTaskRegistry", [taskRegistry]);
    await write(owner, rewardVault, "RewardVault", "setTaskRegistry", [taskRegistry]);
    await write(owner, token, "TestToken", "mintRewardReserve", [rewardVault, parseEther("100000")]);
  });

  async function deploy(wallet: Wallet, name: string, args: readonly unknown[]): Promise<Address> {
    const artifact = artifacts[name];
    const hash = await wallet.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode, args } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Missing deployment address for ${name}`);
    return receipt.contractAddress;
  }

  async function write(wallet: Wallet, address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    const hash = await wallet.writeContract({
      address,
      abi: artifacts[name].abi as Abi,
      functionName,
      args,
    } as never);
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function read(address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    return publicClient.readContract({ address, abi: artifacts[name].abi as Abi, functionName, args } as never);
  }

  async function createAcceptedTask() {
    const evaluators = await registerEvaluationAgents();
    await write(publisher, addresses.token, "TestToken", "faucet");
    await write(publisher, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "createTaskWithMode", [
      4n,
      keccak256(stringToHex("task-spec-v1")),
      parseEther("1000"),
      1, 0,
    ]);
    await approveEvaluation(1n, evaluators);
    await registerAgent(executor, 5n);
    await registerAgent(tester, 6n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("artifact-cid"))]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [
      1n,
      keccak256(stringToHex("artifact-cid")),
    ]);
    await assignTester(1n);
    await write(tester, addresses.taskRegistry, "TaskRegistry", "submitTest", [
      1n,
      true,
      keccak256(stringToHex("coverage-report-cid")),
      [10_000],
    ]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "review", [1n, true, `0x${"0".repeat(64)}`]);
  }

  async function registerAgent(wallet: Wallet, positionId: bigint) {
    await write(wallet, addresses.token, "TestToken", "faucet");
    await write(wallet, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(wallet, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(wallet, addresses.agentRegistry, "AgentRegistry", "register", [positionId]);
  }

  async function registerEvaluationAgents() {
    const transport = custom(provider as never);
    const wallets = [5, 6, 7].map((addressIndex) => createWalletClient({
      account: mnemonicToAccount(mnemonic, { addressIndex }), chain: localChain, transport,
    }));
    for (let index = 0; index < wallets.length; index += 1) await registerAgent(wallets[index], BigInt(index + 1));
    return wallets;
  }

  async function approveEvaluation(taskId: bigint, evaluators: Wallet[]) {
    for (let index = 0; index < 6; index += 1) await provider.request({ method: "evm_mine", params: [] });
    await write(owner, addresses.taskRegistry, "TaskRegistry", "finalizeEvaluationPanel", [taskId]);
    const categories = ["development", "development", "automation"];
    const difficulties = [5_000, 6_000, 7_000];
    const hours = [10, 20, 30];
    const testabilities = [7_000, 8_000, 9_000];
    const rewards = [parseEther("900"), parseEther("1000"), parseEther("1100")];
    for (let index = 0; index < evaluators.length; index += 1) {
      await write(evaluators[index], addresses.taskRegistry, "TaskRegistry", "submitEvaluation", [
        taskId,
        keccak256(stringToHex(categories[index])),
        difficulties[index],
        hours[index],
        testabilities[index],
        rewards[index],
        true,
        keccak256(stringToHex(`evaluation-report-${taskId}-${index}`)),
      ]);
    }
    await write(owner, addresses.taskRegistry, "TaskRegistry", "finalizeTaskEvaluation", [taskId]);
  }

  async function createEvaluatingTask(spec = "evaluation-spec", requestedReward = parseEther("1000")) {
    const evaluators = await registerEvaluationAgents();
    await write(publisher, addresses.token, "TestToken", "faucet");
    await write(publisher, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]);
    const receipt = await write(publisher, addresses.taskRegistry, "TaskRegistry", "createTaskWithMode", [
      4n, keccak256(stringToHex(spec)), requestedReward, 1, 0,
    ]);
    return { evaluators, receipt };
  }

  async function assignTester(taskId: bigint) {
    await write(owner, addresses.taskRegistry, "TaskRegistry", "requestTester", [taskId]);
    for (let index = 0; index < 6; index += 1) await provider.request({ method: "evm_mine", params: [] });
    await write(owner, addresses.taskRegistry, "TaskRegistry", "finalizeTester", [taskId]);
  }

  it("selects three unique evaluators, rejects duplicate reports, and publishes only after approved consensus", async () => {
    const { evaluators, receipt } = await createEvaluatingTask();
    const taskCreatedTopic = keccak256(stringToHex("TaskCreated(uint256,address,uint256,bytes32)"));
    expect(receipt.logs.some((log) => log.topics[0] === taskCreatedTopic)).toBe(false);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "taskPublicationFee", [1n])).toBe(0n);
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("997"));

    for (let index = 0; index < 6; index += 1) await provider.request({ method: "evm_mine", params: [] });
    await write(owner, addresses.taskRegistry, "TaskRegistry", "finalizeEvaluationPanel", [1n]);
    const selected = (await read(addresses.taskRegistry, "TaskRegistry", "getTaskEvaluators", [1n])) as Address[];
    expect(new Set(selected.map((address) => address.toLowerCase())).size).toBe(3);
    expect(selected.map((address) => address.toLowerCase())).not.toContain(publisher.account!.address.toLowerCase());

    const category = keccak256(stringToHex("development"));
    const reportArgs = [1n, category, 6_000, 20, 8_000, parseEther("900"), true, keccak256(stringToHex("report-0"))] as const;
    await write(evaluators[0], addresses.taskRegistry, "TaskRegistry", "submitEvaluation", reportArgs);
    await expect(write(evaluators[0], addresses.taskRegistry, "TaskRegistry", "submitEvaluation", reportArgs)).rejects.toThrow();
    await write(evaluators[1], addresses.taskRegistry, "TaskRegistry", "submitEvaluation", [
      1n, category, 7_000, 30, 6_000, parseEther("800"), true, keccak256(stringToHex("report-1")),
    ]);
    await write(evaluators[2], addresses.taskRegistry, "TaskRegistry", "submitEvaluation", [
      1n, keccak256(stringToHex("other")), 1_000, 2, 9_000, parseEther("1200"), false, keccak256(stringToHex("report-2")),
    ]);
    const finalizeReceipt = await write(owner, addresses.taskRegistry, "TaskRegistry", "finalizeTaskEvaluation", [1n]);
    expect(finalizeReceipt.logs.some((log) => log.topics[0] === taskCreatedTopic)).toBe(true);
    const result = (await read(addresses.taskRegistry, "TaskRegistry", "evaluationResults", [1n])) as readonly unknown[];
    expect(result).toEqual([category, 7_000, 30, 6_000, parseEther("800")]);
    const task = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(task[4]).toBe(parseEther("800"));
    expect(await read(addresses.taskRegistry, "TaskRegistry", "taskPublicationFee", [1n])).toBe(parseEther("16"));
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("981"));
    for (const evaluator of evaluators) {
      expect(await read(addresses.token, "TestToken", "balanceOf", [evaluator.account!.address])).toBe(parseEther("9001"));
    }
  });

  it("releases a rejected evaluation without charging the publication fee and pays only reporters", async () => {
    const { evaluators } = await createEvaluatingTask("rejected-before-publication");
    for (let index = 0; index < 6; index += 1) await provider.request({ method: "evm_mine", params: [] });
    await write(owner, addresses.taskRegistry, "TaskRegistry", "finalizeEvaluationPanel", [1n]);
    for (let index = 0; index < 2; index += 1) {
      await write(evaluators[index], addresses.taskRegistry, "TaskRegistry", "submitEvaluation", [
        1n, keccak256(stringToHex("spam")), 9_000, 100, 1_000, parseEther("10"), false,
        keccak256(stringToHex(`reject-report-${index}`)),
      ]);
    }
    await write(owner, addresses.taskRegistry, "TaskRegistry", "finalizeTaskEvaluation", [1n]);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "taskPublicationFee", [1n])).toBe(0n);
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("997"));
    const position = (await read(addresses.stakeManager, "StakeCreditManager", "positions", [4n])) as readonly unknown[];
    expect(position[2]).toBe(0n);
    expect(await read(addresses.token, "TestToken", "balanceOf", [evaluators[0].account!.address])).toBe(parseEther("9001.5"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [evaluators[1].account!.address])).toBe(parseEther("9001.5"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [evaluators[2].account!.address])).toBe(parseEther("9000"));
  });

  it("executes stake, task, random tester, acceptance, capped grant, and delivery payout", async () => {
    await createAcceptedTask();

    const grant = (await read(addresses.rewardVault, "RewardVault", "getGrant", [1n])) as {
      total: bigint;
      amounts: readonly bigint[];
    };
    expect(grant.total).toBe(parseEther("200"));
    expect(grant.amounts).toEqual([
      parseEther("80"),
      parseEther("40"),
      parseEther("40"),
      parseEther("40"),
    ]);

    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0]);
    expect(await read(addresses.token, "TestToken", "balanceOf", [executor.account!.address])).toBe(parseEther("9052"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [tester.account!.address])).toBe(parseEther("9012"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [reserveAccount.address])).toBe(parseEther("16"));
  });

  it("requires every executor contribution, excludes the whole team from testing, and splits executor rewards", async () => {
    const transport = custom(provider as never);
    const collaborator = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 8 }), chain: localChain, transport });
    const evaluators = await registerEvaluationAgents();
    await write(publisher, addresses.token, "TestToken", "faucet");
    await write(publisher, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "createTaskWithMode", [
      4n, keccak256(stringToHex("two-executor-spec")), parseEther("1000"), 2, 0,
    ]);
    await approveEvaluation(1n, evaluators);
    await registerAgent(executor, 5n);
    await registerAgent(collaborator, 6n);
    await registerAgent(tester, 7n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(collaborator, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("lead-contribution"))]);
    await expect(write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, keccak256(stringToHex("combined-artifact"))])).rejects.toThrow();
    await write(collaborator, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("collaborator-contribution"))]);
    await expect(write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("late-mutation"))])).rejects.toThrow();
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, keccak256(stringToHex("combined-artifact"))]);
    await assignTester(1n);
    const task = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(String(task[2]).toLowerCase()).toBe(tester.account!.address.toLowerCase());
    const expectedExecutors = [executor.account!.address, collaborator.account!.address];
    const canonicalExecutors = [...expectedExecutors]
      .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "getTaskExecutors", [1n])).toEqual(expectedExecutors);
    expect(task[13]).toBe(keccak256(encodeAbiParameters([{ type: "address[]" }], [canonicalExecutors])));
    await expect(write(tester, addresses.taskRegistry, "TaskRegistry", "submitTest", [1n, true, `0x${"0".repeat(64)}`, [6_000, 4_000]])).rejects.toThrow();
    await write(tester, addresses.taskRegistry, "TaskRegistry", "submitTest", [1n, true, keccak256(stringToHex("team-evidence")), [6_000, 4_000]]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "review", [1n, true, `0x${"0".repeat(64)}`]);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "getTaskExecutorWeightsBps", [1n])).toEqual([6_000, 4_000]);
    const grant = (await read(addresses.rewardVault, "RewardVault", "getGrant", [1n])) as { executors: Address[]; executorWeightsBps: number[] };
    expect(grant.executors).toEqual(expectedExecutors);
    expect(grant.executorWeightsBps).toEqual([6_000, 4_000]);
    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0]);
    const expectedBalances = new Map([
      [expectedExecutors[0].toLowerCase(), parseEther("9031.2")],
      [expectedExecutors[1].toLowerCase(), parseEther("9020.8")],
    ]);
    expect(await read(addresses.token, "TestToken", "balanceOf", [executor.account!.address])).toBe(expectedBalances.get(executor.account!.address.toLowerCase()));
    expect(await read(addresses.token, "TestToken", "balanceOf", [collaborator.account!.address])).toBe(expectedBalances.get(collaborator.account!.address.toLowerCase()));
  });

  it("isolates competition candidates on-chain and releases only the tester-selected winner", async () => {
    const transport = custom(provider as never);
    const competitor = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 8 }), chain: localChain, transport });
    const evaluators = await registerEvaluationAgents();
    await write(publisher, addresses.token, "TestToken", "faucet");
    await write(publisher, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "createTaskWithMode", [
      4n, keccak256(stringToHex("competition-spec")), parseEther("1000"), 2, 1,
    ]);
    await approveEvaluation(1n, evaluators);
    await registerAgent(executor, 5n);
    await registerAgent(competitor, 6n);
    await registerAgent(tester, 7n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(competitor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    const candidateA = keccak256(stringToHex("candidate-a"));
    const candidateB = keccak256(stringToHex("candidate-b"));
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, candidateA]);
    await write(competitor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, candidateB]);
    await expect(write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, candidateA])).rejects.toThrow();
    const submitted = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(submitted[19]).toBe(4);
    await assignTester(1n);
    await expect(write(tester, addresses.taskRegistry, "TaskRegistry", "submitCompetitionTest", [
      1n, true, executor.account!.address, candidateB, keccak256(stringToHex("invalid-selection")), [7_000, 3_000],
    ])).rejects.toThrow();
    await write(tester, addresses.taskRegistry, "TaskRegistry", "submitCompetitionTest", [
      1n, true, competitor.account!.address, candidateB, keccak256(stringToHex("competition-evidence")), [3_000, 7_000],
    ]);
    const reviewed = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(reviewed[7]).toBe(candidateB);
    expect(reviewed[19]).toBe(7);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "review", [1n, false, keccak256(stringToHex("competition-rejection"))]);
    await expect(write(executor, addresses.taskRegistry, "TaskRegistry", "respondToRejection", [1n, keccak256(stringToHex("loser-response"))])).rejects.toThrow();
    await write(competitor, addresses.taskRegistry, "TaskRegistry", "respondToRejection", [1n, keccak256(stringToHex("winner-response"))]);
    await write(owner, addresses.taskRegistry, "TaskRegistry", "resolveRejection", [1n, true, keccak256(stringToHex("winner-resolution"))]);
    const grant = (await read(addresses.rewardVault, "RewardVault", "getGrant", [1n])) as { executorWeightsBps: number[] };
    expect(grant.executorWeightsBps).toEqual([3_000, 7_000]);
  });

  it("rejects stake reuse, early maintenance, duplicate grant path, and double claim", async () => {
    await createAcceptedTask();

    await write(executor, addresses.stakeManager, "StakeCreditManager", "requestWithdrawal", [5n]);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "isEligible", [executor.account!.address])).toBe(false);

    await expect(
      write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]),
    ).rejects.toThrow();
    await expect(
      write(tester, addresses.taskRegistry, "TaskRegistry", "validateMaintenance", [
        1n,
        1,
        true,
        keccak256(stringToHex("maintenance-too-early")),
      ]),
    ).rejects.toThrow();
    await expect(
      write(tester, addresses.taskRegistry, "TaskRegistry", "validateMaintenance", [
        1n,
        1,
        false,
        keccak256(stringToHex("maintenance-failure-too-early")),
      ]),
    ).rejects.toThrow();

    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0]);
    await expect(write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0])).rejects.toThrow();
    await expect(
      write(publisher, addresses.taskRegistry, "TaskRegistry", "review", [1n, true, `0x${"0".repeat(64)}`]),
    ).rejects.toThrow();
  });

  it("unlocks maintenance only after due time and releases the stake after day 90", async () => {
    await createAcceptedTask();
    const transport = custom(provider as never);
    const replacement = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 8 }), chain: localChain, transport });
    const repairTester = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 9 }), chain: localChain, transport });
    await registerAgent(replacement, 7n);
    await registerAgent(repairTester, 8n);

    await provider.request({ method: "evm_increaseTime", params: [90 * 24 * 60 * 60] });
    await provider.request({ method: "evm_mine", params: [] });
    await expect(
      write(tester, addresses.taskRegistry, "TaskRegistry", "validateMaintenance", [
        1n,
        3,
        true,
        keccak256(stringToHex("cannot-skip-checkpoints")),
      ]),
    ).rejects.toThrow();
    await expect(
      write(executor, addresses.taskRegistry, "TaskRegistry", "validateMaintenance", [
        1n, 1, true, keccak256(stringToHex("executor-self-validation")),
      ]),
    ).rejects.toThrow();
    await write(tester, addresses.taskRegistry, "TaskRegistry", "validateMaintenance", [
      1n, 1, false, keccak256(stringToHex("maintenance-unhealthy")),
    ]);
    await expect(write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 1])).rejects.toThrow();
    await expect(write(owner, addresses.taskRegistry, "TaskRegistry", "evictInactiveExecutor", [1n, executor.account!.address])).rejects.toThrow();
    await provider.request({ method: "evm_increaseTime", params: [6 * 60 * 60 + 1] });
    await provider.request({ method: "evm_mine", params: [] });
    await write(owner, addresses.taskRegistry, "TaskRegistry", "evictInactiveExecutor", [1n, executor.account!.address]);
    await write(executor, addresses.stakeManager, "StakeCreditManager", "requestWithdrawal", [5n]);
    await write(tester, addresses.stakeManager, "StakeCreditManager", "requestWithdrawal", [6n]);
    await write(replacement, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "getTaskExecutors", [1n])).toEqual([replacement.account!.address]);
    const repairedArtifact = keccak256(stringToHex("maintenance-repair-v2"));
    await write(replacement, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, repairedArtifact]);
    await write(replacement, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, repairedArtifact]);
    await assignTester(1n);
    const testingTask = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(String(testingTask[2]).toLowerCase()).toBe(repairTester.account!.address.toLowerCase());
    await write(repairTester, addresses.taskRegistry, "TaskRegistry", "submitTest", [
      1n, true, keccak256(stringToHex("maintenance-repair-tested")), [10_000],
    ]);
    const repairedTask = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(repairedTask[7]).toBe(repairedArtifact);
    expect(repairedTask[19]).toBe(8);
    const repairedCheckpoint = (await read(addresses.rewardVault, "RewardVault", "getCheckpointParticipants", [1n, 1])) as [Address[], number[], Address];
    expect(repairedCheckpoint).toEqual([[replacement.account!.address], [10_000], repairTester.account!.address]);
    const originalCheckpoint = (await read(addresses.rewardVault, "RewardVault", "getCheckpointParticipants", [1n, 0])) as [Address[], number[], Address];
    expect(originalCheckpoint).toEqual([[executor.account!.address], [10_000], tester.account!.address]);
    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0]);
    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 1]);
    for (const checkpoint of [2, 3] as const) {
      await write(repairTester, addresses.taskRegistry, "TaskRegistry", "validateMaintenance", [
        1n,
        checkpoint,
        true,
        keccak256(stringToHex(`maintenance-${checkpoint}`)),
      ]);
      await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, checkpoint]);
    }

    const position = (await read(addresses.stakeManager, "StakeCreditManager", "positions", [4n])) as readonly unknown[];
    expect(position[2]).toBe(0n);
    // The evicted executor receives no maintenance reward; all three future
    // 40-token tranches use the replacement's independently tested weight.
    expect(await read(addresses.token, "TestToken", "balanceOf", [executor.account!.address])).toBe(parseEther("9052"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [replacement.account!.address])).toBe(parseEther("9078"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [tester.account!.address])).toBe(parseEther("9012"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [repairTester.account!.address])).toBe(parseEther("9018"));
  });

  it("resolves structured rejection without trapping the publishing slot", async () => {
    const evaluators = await registerEvaluationAgents();
    await write(publisher, addresses.token, "TestToken", "faucet");
    await write(publisher, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "createTaskWithMode", [4n, keccak256(stringToHex("rejected-spec")), parseEther("1000"), 1, 0]);
    await approveEvaluation(1n, evaluators);
    await registerAgent(executor, 5n);
    await registerAgent(tester, 6n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("artifact"))]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, keccak256(stringToHex("artifact"))]);
    await assignTester(1n);
    await write(tester, addresses.taskRegistry, "TaskRegistry", "submitTest", [1n, true, keccak256(stringToHex("evidence")), [10_000]]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "review", [1n, false, keccak256(stringToHex("criterion-1-mismatch"))]);
    await expect(write(owner, addresses.taskRegistry, "TaskRegistry", "resolveRejection", [1n, false, keccak256(stringToHex("premature-resolution"))])).rejects.toThrow();
    await write(executor, addresses.taskRegistry, "TaskRegistry", "respondToRejection", [1n, keccak256(stringToHex("executor-response-proof"))]);
    await write(owner, addresses.taskRegistry, "TaskRegistry", "resolveRejection", [1n, false, keccak256(stringToHex("publisher-wins-proof"))]);
    const position = (await read(addresses.stakeManager, "StakeCreditManager", "positions", [4n])) as readonly unknown[];
    expect(position[2]).toBe(0n);
  });

  it("slashes abusive publisher rejection and rewards the executor path", async () => {
    const evaluators = await registerEvaluationAgents();
    await write(publisher, addresses.token, "TestToken", "faucet");
    await write(publisher, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "createTaskWithMode", [4n, keccak256(stringToHex("abusive-rejection")), parseEther("1000"), 1, 0]);
    await approveEvaluation(1n, evaluators);
    await registerAgent(executor, 5n);
    await registerAgent(tester, 6n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("artifact"))]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, keccak256(stringToHex("artifact"))]);
    await assignTester(1n);
    await write(tester, addresses.taskRegistry, "TaskRegistry", "submitTest", [1n, true, keccak256(stringToHex("evidence")), [10_000]]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "review", [1n, false, keccak256(stringToHex("bad-rejection"))]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "respondToRejection", [1n, keccak256(stringToHex("executor-appeal"))]);
    const transport = custom(provider as never);
    const arbitratorA = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 5 }), chain: localChain, transport });
    const arbitratorB = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 6 }), chain: localChain, transport });
    const arbitratorC = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 7 }), chain: localChain, transport });
    const resolver = await deploy(owner, "DisputeResolver", [addresses.taskRegistry, [arbitratorA.account!.address, arbitratorB.account!.address, arbitratorC.account!.address], 2n, owner.account!.address]);
    await write(owner, addresses.taskRegistry, "TaskRegistry", "setDisputeResolver", [resolver]);
    const resolution = keccak256(stringToHex("executor-wins-proof"));
    const competingResolution = keccak256(stringToHex("different-executor-proof"));
    const publisherResolution = keccak256(stringToHex("publisher-proof"));
    await write(arbitratorA, resolver, "DisputeResolver", "vote", [1n, true, resolution]);
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("977"));
    await expect(write(arbitratorA, resolver, "DisputeResolver", "vote", [1n, true, resolution])).rejects.toThrow();
    await write(arbitratorB, resolver, "DisputeResolver", "vote", [1n, true, competingResolution]);
    await write(arbitratorC, resolver, "DisputeResolver", "vote", [1n, false, publisherResolution]);
    expect(await read(resolver, "DisputeResolver", "resolved", [1n])).toBe(false);
    await write(arbitratorC, resolver, "DisputeResolver", "changeVote", [1n, true, resolution]);
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("928.15"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [addresses.rewardVault])).toBe(parseEther("100068.85"));
  });

  it("applies every repeated-collaboration decay step after the stake cap", async () => {
    const vault = await deploy(owner, "RewardVault", [addresses.token, reserveAccount.address, parseEther("100000"), owner.account!.address]);
    await write(owner, vault, "RewardVault", "setTaskRegistry", [owner.account!.address]);
    await write(owner, addresses.token, "TestToken", "mintRewardReserve", [vault, parseEther("100000")]);
    const collaborationKey = keccak256(stringToHex("same-publisher-canonical-team-and-tester"));
    const totals: bigint[] = [];
    for (let index = 0; index < 5; index += 1) {
      const taskId = BigInt(100 + index);
      await write(owner, vault, "RewardVault", "createGrant", [
        taskId, [executor.account!.address], [10_000], tester.account!.address,
        collaborationKey, parseEther("1000"), parseEther("1000"),
      ]);
      const grant = (await read(vault, "RewardVault", "getGrant", [taskId])) as { total: bigint };
      totals.push(grant.total);
    }
    expect(totals).toEqual(["200", "140", "80", "40", "20"].map((value) => parseEther(value)));
  });
});
