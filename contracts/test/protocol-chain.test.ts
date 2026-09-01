import ganache from "ganache";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
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
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });
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
  let testerB: Wallet;
  let testerC: Wallet;
  let reserveAccount: ReturnType<typeof mnemonicToAccount>;
  let addresses: Record<"token" | "stakeManager" | "agentRegistry" | "rewardVault" | "taskRegistry" | "verificationPanel" | "protocolEconomics", Address>;

  beforeAll(() => {
    artifacts = compileContracts();
  });

  beforeEach(async () => {
    provider = ganache.provider({
      logging: { quiet: true },
      chain: { chainId: localChain.id },
      wallet: { mnemonic, totalAccounts: 20, defaultBalance: 1_000 },
    });
    const transport = custom(provider as never);
    publicClient = createPublicClient({ chain: localChain, transport });
    owner = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 0 }), chain: localChain, transport });
    publisher = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 1 }), chain: localChain, transport });
    executor = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 2 }), chain: localChain, transport });
    tester = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 3 }), chain: localChain, transport });
    testerB = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 10 }), chain: localChain, transport });
    testerC = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 11 }), chain: localChain, transport });
    reserveAccount = mnemonicToAccount(mnemonic, { addressIndex: 4 });

    const ownerAddress = owner.account!.address;
    const token = await deploy(owner, "TestToken", [ownerAddress]);
    const stakeManager = await deploy(owner, "StakeCreditManager", [token, ownerAddress]);
    const agentRegistry = await deploy(owner, "AgentRegistry", [stakeManager]);
    const rewardVault = await deploy(owner, "RewardVault", [token, reserveAccount.address, parseEther("100000"), ownerAddress]);
    const taskRegistry = await deploy(owner, "TaskRegistry", [stakeManager, rewardVault, agentRegistry, ownerAddress, ownerAddress]);
    const verificationPanel = await deploy(owner, "VerificationPanel", [taskRegistry, rewardVault, agentRegistry, ownerAddress]);
    const daoTreasury = mnemonicToAccount(mnemonic, { addressIndex: 12 }).address;
    const securityReserve = mnemonicToAccount(mnemonic, { addressIndex: 13 }).address;
    const protocolEconomics = await deploy(owner, "ProtocolEconomics", [
      token, rewardVault, daoTreasury, securityReserve,
      "0x000000000000000000000000000000000000dEaD", 365 * 24 * 60 * 60, ownerAddress,
    ]);
    addresses = { token, stakeManager, agentRegistry, rewardVault, taskRegistry, verificationPanel, protocolEconomics };

    for (const [name, address] of Object.entries(addresses)) {
      const artifactName = ({ token: "TestToken", stakeManager: "StakeCreditManager", agentRegistry: "AgentRegistry", rewardVault: "RewardVault", taskRegistry: "TaskRegistry", verificationPanel: "VerificationPanel", protocolEconomics: "ProtocolEconomics" } as const)[name as keyof typeof addresses];
      verifyRuntimeBytecode(name, await publicClient.getCode({ address }), artifacts[artifactName]);
    }

    await write(owner, stakeManager, "StakeCreditManager", "setTaskRegistry", [taskRegistry]);
    await write(owner, rewardVault, "RewardVault", "setTaskRegistry", [taskRegistry]);
    await write(owner, taskRegistry, "TaskRegistry", "setVerificationPanel", [verificationPanel]);
    await write(owner, rewardVault, "RewardVault", "setVerificationPanel", [verificationPanel]);
    await write(owner, protocolEconomics, "ProtocolEconomics", "configureProtocol", [taskRegistry, stakeManager]);
    await write(owner, stakeManager, "StakeCreditManager", "setProtocolEconomics", [protocolEconomics]);
    await write(owner, rewardVault, "RewardVault", "setProtocolEconomics", [protocolEconomics]);
    await write(owner, taskRegistry, "TaskRegistry", "setProtocolEconomics", [protocolEconomics]);
    await write(owner, agentRegistry, "AgentRegistry", "setOutcomeReporter", [verificationPanel, 7]);
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
    await registerTesterPool(6n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("artifact-cid"))]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [
      1n,
      keccak256(stringToHex("artifact-cid")),
    ]);
    await assignTester(1n);
    await completeVerificationPanel(1n, true, [10_000]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "review", [1n, true, `0x${"0".repeat(64)}`]);
  }

  async function registerAgent(wallet: Wallet, positionId: bigint) {
    await write(wallet, addresses.token, "TestToken", "faucet");
    await write(wallet, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(wallet, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(wallet, addresses.agentRegistry, "AgentRegistry", "register", [positionId]);
  }

  async function registerAgentWithCapabilities(wallet: Wallet, positionId: bigint, capabilities: number) {
    await write(wallet, addresses.token, "TestToken", "faucet");
    await write(wallet, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(wallet, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(wallet, addresses.agentRegistry, "AgentRegistry", "registerWithCapabilities", [positionId, capabilities]);
  }

  async function registerTesterPool(firstPositionId: bigint) {
    await registerAgent(tester, firstPositionId);
    await registerAgent(testerB, firstPositionId + 1n);
    await registerAgent(testerC, firstPositionId + 2n);
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
    await finalizeRequestedTester(taskId);
  }

  async function finalizeRequestedTester(taskId: bigint) {
    for (let index = 0; index < 6; index += 1) await provider.request({ method: "evm_mine", params: [] });
    const receipt = await write(owner, addresses.taskRegistry, "TaskRegistry", "finalizeTester", [taskId]);
    const panelStartedLog = receipt.logs.find((log) => {
      if (log.address.toLowerCase() !== addresses.verificationPanel.toLowerCase()) return false;
      try { return decodeEventLog({ abi: artifacts.VerificationPanel.abi as Abi, data: log.data, topics: log.topics }).eventName === "PanelStarted"; }
      catch { return false; }
    });
    if (!panelStartedLog) throw new Error("PANEL_STARTED_EVENT_MISSING");
    const panelStarted = decodeEventLog({ abi: artifacts.VerificationPanel.abi as Abi, data: panelStartedLog.data, topics: panelStartedLog.topics });
    expect(Number((panelStarted.args as { epoch: number }).epoch)).toBeGreaterThan(0);
  }

  async function revealVerificationPanel(taskId: bigint, passed: boolean, executorWeightsBps: number[], winner: Address = `0x${"0".repeat(40)}`, selectedArtifactHash: `0x${string}` = `0x${"0".repeat(64)}`) {
    const selected = (await read(addresses.taskRegistry, "TaskRegistry", "getTaskTesters", [taskId])) as Address[];
    const panel = (await read(addresses.verificationPanel, "VerificationPanel", "getPanel", [taskId])) as { workRound: number; checkpoint: number };
    const workRound = Number(panel.workRound);
    const checkpoint = Number(panel.checkpoint);
    const transport = custom(provider as never);
    const wallets = Array.from({ length: 20 }, (_, addressIndex) => createWalletClient({
      account: mnemonicToAccount(mnemonic, { addressIndex }), chain: localChain, transport,
    }));
    const byAddress = new Map(wallets.map((wallet) => [wallet.account!.address.toLowerCase(), wallet]));
    const masks = [3, 5, 6];
    const reveals = selected.map((address, shard) => {
      const wallet = byAddress.get(address.toLowerCase());
      if (!wallet) throw new Error(`TEST_WALLET_NOT_MAPPED_${address}`);
      const evidenceHash = keccak256(stringToHex(`panel-evidence-${taskId}-${shard}`));
      const salt = keccak256(stringToHex(`panel-salt-${taskId}-${shard}`));
      const criterionPassMask = passed ? masks[shard] : 0;
      const weights = passed ? executorWeightsBps : [];
      const commitment = keccak256(encodeAbiParameters([
        { type: "uint256" }, { type: "uint32" }, { type: "uint8" }, { type: "uint8" }, { type: "uint16" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint16[]" }, { type: "bytes32" },
      ], [taskId, workRound, checkpoint, shard, criterionPassMask, winner, selectedArtifactHash, evidenceHash, weights, salt]));
      return { wallet, criterionPassMask, evidenceHash, salt, weights, commitment };
    });
    for (const reveal of reveals) await write(reveal.wallet, addresses.verificationPanel, "VerificationPanel", "commitShard", [taskId, reveal.commitment]);
    for (const reveal of reveals) await write(reveal.wallet, addresses.verificationPanel, "VerificationPanel", "revealShard", [taskId, reveal.criterionPassMask, winner, selectedArtifactHash, reveal.evidenceHash, reveal.weights, reveal.salt]);
    return { selected, reveals };
  }

  async function completeVerificationPanel(taskId: bigint, passed: boolean, executorWeightsBps: number[], winner: Address = `0x${"0".repeat(40)}`, selectedArtifactHash: `0x${string}` = `0x${"0".repeat(64)}`) {
    await revealVerificationPanel(taskId, passed, executorWeightsBps, winner, selectedArtifactHash);
    await provider.request({ method: "evm_increaseTime", params: [24 * 60 * 60 + 1] });
    await provider.request({ method: "evm_mine", params: [] });
    await write(owner, addresses.verificationPanel, "VerificationPanel", "finalize", [taskId]);
  }

  it("requires staked registered challenges and exact 2-of-3 arbitration evidence before returning a voided panel to correction", async () => {
    const transport = custom(provider as never);
    const challenger = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 12 }), chain: localChain, transport });
    const arbitrators = [13, 14, 15].map((addressIndex) => createWalletClient({
      account: mnemonicToAccount(mnemonic, { addressIndex }), chain: localChain, transport,
    }));
    const court = await deploy(owner, "VerificationArbitrationCourt", [
      addresses.token, addresses.verificationPanel, addresses.agentRegistry, reserveAccount.address,
      arbitrators.map((wallet) => wallet.account!.address),
    ]);
    await write(owner, addresses.verificationPanel, "VerificationPanel", "setArbitrationCourt", [court]);
    await write(owner, addresses.stakeManager, "StakeCreditManager", "setQualitySlasher", [court]);

    const evaluators = await registerEvaluationAgents();
    await write(publisher, addresses.token, "TestToken", "faucet");
    await write(publisher, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]);
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "createTaskWithMode", [
      4n, keccak256(stringToHex("arbitrated-panel")), parseEther("1000"), 1, 0,
    ]);
    await approveEvaluation(1n, evaluators);
    await registerAgent(executor, 5n);
    await registerTesterPool(6n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("challenged-artifact"))]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, keccak256(stringToHex("challenged-artifact"))]);
    await assignTester(1n);
    const { selected } = await revealVerificationPanel(1n, true, [10_000]);
    // Join only after the panel snapshot so the challenger cannot also be a
    // validator in the case it opens.
    await registerAgent(challenger, 9n);

    for (const wallet of arbitrators) {
      await write(wallet, addresses.token, "TestToken", "faucet");
      await write(wallet, addresses.token, "TestToken", "approve", [court, parseEther("500")]);
      await write(wallet, court, "VerificationArbitrationCourt", "deposit", [parseEther("500")]);
    }
    await write(challenger, addresses.token, "TestToken", "approve", [court, parseEther("500")]);
    await write(challenger, court, "VerificationArbitrationCourt", "deposit", [parseEther("500")]);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "isEligible", [challenger.account!.address])).toBe(true);
    expect(await read(addresses.verificationPanel, "VerificationPanel", "isPanelTester", [1n, challenger.account!.address])).toBe(false);
    expect(await read(court, "VerificationArbitrationCourt", "isArbitrator", [challenger.account!.address])).toBe(false);
    expect(await read(court, "VerificationArbitrationCourt", "activeCaseId", [1n])).toBe(`0x${"0".repeat(64)}`);
    expect((await read(addresses.verificationPanel, "VerificationPanel", "getPanel", [1n]) as { status: number }).status).toBe(3);
    await expect(write(owner, court, "VerificationArbitrationCourt", "openChallenge", [1n, selected[0], keccak256(stringToHex("not-a-registered-agent"))])).rejects.toThrow();
    const challengeHash = keccak256(stringToHex("validator-used-copied-report"));
    await write(challenger, court, "VerificationArbitrationCourt", "openChallenge", [1n, selected[0], challengeHash]);
    await expect(write(challenger, court, "VerificationArbitrationCourt", "withdraw", [parseEther("1")])).rejects.toThrow();
    await expect(write(owner, addresses.verificationPanel, "VerificationPanel", "finalize", [1n])).rejects.toThrow();

    const acceptedResolution = keccak256(stringToHex("independent-reproduction-proves-copy"));
    const conflictingResolution = keccak256(stringToHex("different-reason"));
    await write(arbitrators[0], court, "VerificationArbitrationCourt", "vote", [1n, true, acceptedResolution]);
    await write(arbitrators[1], court, "VerificationArbitrationCourt", "vote", [1n, true, conflictingResolution]);
    const caseId = await read(court, "VerificationArbitrationCourt", "activeCaseId", [1n]) as `0x${string}`;
    expect((await read(court, "VerificationArbitrationCourt", "cases", [caseId]) as readonly unknown[]).at(-1)).toBe(false);
    const targetReport = await read(addresses.verificationPanel, "VerificationPanel", "getReport", [1n, selected[0]]) as { evidenceHash: `0x${string}` };
    const reserveBeforeResolution = await read(addresses.token, "TestToken", "balanceOf", [reserveAccount.address]) as bigint;
    const resolutionReceipt = await write(arbitrators[2], court, "VerificationArbitrationCourt", "vote", [1n, true, acceptedResolution]);
    const qualityTopic = keccak256(stringToHex("AgentQualityUpdated(address,uint8,bytes32,uint16,uint32,uint8,uint64,bool,bool,bool,bytes32)"));
    const qualityLog = resolutionReceipt.logs.find((log) =>
      log.address.toLowerCase() === addresses.agentRegistry.toLowerCase() && log.topics[0] === qualityTopic);
    if (!qualityLog) throw new Error("AGENT_QUALITY_LOG_MISSING");
    const qualityEvent = decodeEventLog({ abi: artifacts.AgentRegistry.abi as Abi, data: qualityLog.data, topics: qualityLog.topics });
    const expectedQualityEvidence = keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
      [caseId, acceptedResolution, selected[0], targetReport.evidenceHash, challengeHash],
    ));
    expect(qualityEvent.eventName).toBe("AgentQualityUpdated");
    expect((qualityEvent.args as { evidenceHash: string }).evidenceHash).toBe(expectedQualityEvidence);

    const dispute = await read(court, "VerificationArbitrationCourt", "cases", [caseId]) as readonly unknown[];
    expect(dispute.at(-1)).toBe(true);
    expect(await read(court, "VerificationArbitrationCourt", "stake", [selected[0]])).toBe(0n);
    const targetPosition = await read(addresses.agentRegistry, "AgentRegistry", "agentPosition", [selected[0]]) as bigint;
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [targetPosition])).toBe(parseEther("900"));
    expect(await read(court, "VerificationArbitrationCourt", "stake", [challenger.account!.address])).toBe(parseEther("560"));
    expect((await read(addresses.token, "TestToken", "balanceOf", [reserveAccount.address]) as bigint) - reserveBeforeResolution).toBe(parseEther("40"));
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [selected[0], 2])).toMatchObject({ scoreBps: 3_500, severeFaults: 1 });
    const corrected = await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n]) as readonly unknown[];
    expect(corrected[17]).toBe(2);
    expect(corrected[19]).toBe(6);
  });

  it("selects three unique evaluators, rejects duplicate reports, and publishes only after approved consensus", async () => {
    const { evaluators, receipt } = await createEvaluatingTask();
    const taskCreatedTopic = keccak256(stringToHex("TaskCreated(uint256,address,uint256,bytes32)"));
    expect(receipt.logs.some((log) => log.topics[0] === taskCreatedTopic)).toBe(false);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "taskPublicationFee", [1n])).toBe(0n);
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("998"));

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
    await write(owner, addresses.verificationPanel, "VerificationPanel", "settleEvaluationOutcomes", [1n]);
    await expect(write(owner, addresses.verificationPanel, "VerificationPanel", "settleEvaluationOutcomes", [1n])).rejects.toThrow();
    expect(finalizeReceipt.logs.some((log) => log.topics[0] === taskCreatedTopic)).toBe(true);
    const result = (await read(addresses.taskRegistry, "TaskRegistry", "evaluationResults", [1n])) as readonly unknown[];
    expect(result).toEqual([category, 7_000, 30, 6_000, parseEther("800")]);
    const task = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(task[4]).toBe(parseEther("800"));
    expect(await read(addresses.taskRegistry, "TaskRegistry", "taskPublicationFee", [1n])).toBe(parseEther("3"));
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("995"));
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [evaluators[0].account!.address, 4])).toMatchObject({ scoreBps: 5_200, outcomeCount: 1 });
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [evaluators[1].account!.address, 4])).toMatchObject({ scoreBps: 5_200, outcomeCount: 1 });
    expect(await read(addresses.agentRegistry, "AgentRegistry", "independentPositiveOutcomeCount", [evaluators[0].account!.address, 4])).toBe(1);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "independentPositiveOutcomeCount", [evaluators[1].account!.address, 4])).toBe(1);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [evaluators[2].account!.address, 4])).toMatchObject({ scoreBps: 5_000, outcomeCount: 0 });
    for (const evaluator of evaluators) {
      expect(await read(addresses.token, "TestToken", "balanceOf", [evaluator.account!.address])).toBe(9_000n * 10n ** 18n + parseEther("0.7") / 3n);
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
    await write(owner, addresses.verificationPanel, "VerificationPanel", "settleEvaluationOutcomes", [1n]);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "taskPublicationFee", [1n])).toBe(0n);
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("998"));
    const position = (await read(addresses.stakeManager, "StakeCreditManager", "positions", [4n])) as readonly unknown[];
    expect(position[2]).toBe(0n);
    expect(await read(addresses.token, "TestToken", "balanceOf", [evaluators[0].account!.address])).toBe(parseEther("9000.35"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [evaluators[1].account!.address])).toBe(parseEther("9000.35"));
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [evaluators[0].account!.address, 4])).toMatchObject({ scoreBps: 5_200, outcomeCount: 1 });
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [evaluators[1].account!.address, 4])).toMatchObject({ scoreBps: 5_200, outcomeCount: 1 });
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [evaluators[2].account!.address, 4])).toMatchObject({ scoreBps: 4_500, outcomeCount: 1 });
    expect(await read(addresses.token, "TestToken", "balanceOf", [evaluators[2].account!.address])).toBe(parseEther("9000"));
  });

  it("executes stake, task, random tester, acceptance, capped grant, and delivery payout", async () => {
    await createAcceptedTask();

    const grant = (await read(addresses.rewardVault, "RewardVault", "getGrant", [1n])) as {
      total: bigint;
      amounts: readonly bigint[];
    };
    expect(grant.total).toBe(parseEther("190"));
    expect(grant.amounts).toEqual([
      parseEther("76"),
      parseEther("38"),
      parseEther("38"),
      parseEther("38"),
    ]);

    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0]);
    expect(await read(addresses.token, "TestToken", "balanceOf", [executor.account!.address])).toBe(parseEther("9060.8"));
    const panelBalances = await Promise.all([tester, testerB, testerC].map((wallet) => read(addresses.token, "TestToken", "balanceOf", [wallet.account!.address]) as Promise<bigint>));
    expect(panelBalances.reduce((sum, balance) => sum + balance - parseEther("9000"), 0n)).toBe(parseEther("15.2"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [reserveAccount.address])).toBe(1n);
  });

  it("selects a tester only when every task verification capability matches", async () => {
    const transport = custom(provider as never);
    const specialist = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 8 }), chain: localChain, transport });
    const evaluators = await registerEvaluationAgents();
    await write(publisher, addresses.token, "TestToken", "faucet");
    await write(publisher, addresses.token, "TestToken", "approve", [addresses.stakeManager, parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
    await write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]);
    const requiredCapabilities = 2 | 8 | 32; // TEST + AUTOMATED_TEST + DATA_VALIDATION
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "createTaskWithModeAndTesterCapabilities", [
      4n, keccak256(stringToHex("typed-verification-spec")), parseEther("1000"), 1, 0, requiredCapabilities,
    ]);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "taskRequiredTesterCapabilities", [1n])).toBe(requiredCapabilities);
    await approveEvaluation(1n, evaluators);
    await registerAgent(executor, 5n);
    await registerAgent(tester, 6n); // role-capable, but no verification speciality
    await registerAgentWithCapabilities(specialist, 7n, requiredCapabilities);
    await registerAgentWithCapabilities(testerB, 8n, requiredCapabilities);
    await registerAgentWithCapabilities(testerC, 9n, requiredCapabilities);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    const artifact = keccak256(stringToHex("typed-verification-artifact"));
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, artifact]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, artifact]);
    await assignTester(1n);
    const selected = (await read(addresses.taskRegistry, "TaskRegistry", "getTaskTesters", [1n])) as Address[];
    expect(new Set(selected.map((address) => address.toLowerCase()))).toEqual(new Set([specialist, testerB, testerC].map((wallet) => wallet.account!.address.toLowerCase())));
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
    await registerTesterPool(7n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(collaborator, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("lead-contribution"))]);
    await expect(write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, keccak256(stringToHex("combined-artifact"))])).rejects.toThrow();
    await write(collaborator, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("collaborator-contribution"))]);
    await expect(write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("late-mutation"))])).rejects.toThrow();
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, keccak256(stringToHex("combined-artifact"))]);
    await assignTester(1n);
    const task = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(new Set(((await read(addresses.taskRegistry, "TaskRegistry", "getTaskTesters", [1n])) as Address[]).map((address) => address.toLowerCase())).size).toBe(3);
    const expectedExecutors = [executor.account!.address, collaborator.account!.address];
    const canonicalExecutors = [...expectedExecutors]
      .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "getTaskExecutors", [1n])).toEqual(expectedExecutors);
    expect(task[13]).toBe(keccak256(encodeAbiParameters([{ type: "address[]" }], [canonicalExecutors])));
    expect(await read(addresses.verificationPanel, "VerificationPanel", "getExecutorQualityMultipliers", [1n])).toEqual([10_000, 10_000]);
    await completeVerificationPanel(1n, true, [6_000, 4_000]);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [executor.account!.address, 1])).toMatchObject({ scoreBps: 5_200, outcomeCount: 1 });
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [collaborator.account!.address, 1])).toMatchObject({ scoreBps: 5_200, outcomeCount: 1 });
    await write(publisher, addresses.taskRegistry, "TaskRegistry", "review", [1n, true, `0x${"0".repeat(64)}`]);
    expect(await read(addresses.taskRegistry, "TaskRegistry", "getTaskExecutorWeightsBps", [1n])).toEqual([6_000, 4_000]);
    const grant = (await read(addresses.rewardVault, "RewardVault", "getGrant", [1n])) as { executors: Address[]; executorWeightsBps: number[] };
    expect(grant.executors).toEqual(expectedExecutors);
    expect(grant.executorWeightsBps).toEqual([6_000, 4_000]);
    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0]);
    const expectedBalances = new Map([
      [expectedExecutors[0].toLowerCase(), parseEther("9036.48")],
      [expectedExecutors[1].toLowerCase(), parseEther("9024.32")],
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
    await registerTesterPool(7n);
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
    await completeVerificationPanel(1n, true, [3_000, 7_000], competitor.account!.address, candidateB);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [competitor.account!.address, 1])).toMatchObject({ scoreBps: 5_200, outcomeCount: 1 });
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [executor.account!.address, 1])).toMatchObject({ scoreBps: 5_000, outcomeCount: 0 });
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

    const registryHashBeforeRepeat = await read(addresses.agentRegistry, "AgentRegistry", "registryHash");
    const agentCountBeforeRepeat = await read(addresses.agentRegistry, "AgentRegistry", "agentCount");
    await write(executor, addresses.agentRegistry, "AgentRegistry", "register", [5n]);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "registryHash")).toBe(registryHashBeforeRepeat);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "agentCount")).toBe(agentCountBeforeRepeat);

    const registryHashBeforePause = await read(addresses.agentRegistry, "AgentRegistry", "registryHash");
    await write(executor, addresses.agentRegistry, "AgentRegistry", "setActive", [false]);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "isEligible", [executor.account!.address])).toBe(false);
    const registryHashAfterPause = await read(addresses.agentRegistry, "AgentRegistry", "registryHash");
    expect(registryHashAfterPause).not.toBe(registryHashBeforePause);
    await write(executor, addresses.agentRegistry, "AgentRegistry", "setActive", [false]);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "registryHash")).toBe(registryHashAfterPause);
    await expect(write(owner, addresses.agentRegistry, "AgentRegistry", "setActive", [false])).rejects.toThrow();
    await write(executor, addresses.agentRegistry, "AgentRegistry", "setActive", [true]);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "isEligible", [executor.account!.address])).toBe(true);

    await write(executor, addresses.stakeManager, "StakeCreditManager", "requestWithdrawal", [5n]);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "isEligible", [executor.account!.address])).toBe(false);

    await expect(
      write(publisher, addresses.stakeManager, "StakeCreditManager", "issueCredit", [4n]),
    ).rejects.toThrow();
    await expect(
      write(owner, addresses.taskRegistry, "TaskRegistry", "requestMaintenancePanel", [1n, 1]),
    ).rejects.toThrow();
    await expect(
      write(owner, addresses.taskRegistry, "TaskRegistry", "requestMaintenancePanel", [1n, 1]),
    ).rejects.toThrow();

    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0]);
    await expect(write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0])).rejects.toThrow();
    await expect(
      write(publisher, addresses.taskRegistry, "TaskRegistry", "review", [1n, true, `0x${"0".repeat(64)}`]),
    ).rejects.toThrow();
  });

  it("unlocks maintenance only after due time and releases the stake after day 90", async () => {
    await createAcceptedTask();
    const initialPanel = (await read(addresses.taskRegistry, "TaskRegistry", "getTaskTesters", [1n])) as Address[];
    const transport = custom(provider as never);
    const replacement = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 8 }), chain: localChain, transport });
    const repairTester = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 9 }), chain: localChain, transport });
    await registerAgent(replacement, 9n);
    await registerAgent(repairTester, 10n);

    await provider.request({ method: "evm_increaseTime", params: [90 * 24 * 60 * 60] });
    await provider.request({ method: "evm_mine", params: [] });
    await expect(
      write(owner, addresses.taskRegistry, "TaskRegistry", "requestMaintenancePanel", [1n, 3]),
    ).rejects.toThrow();
    await expect(
      write(executor, addresses.taskRegistry, "TaskRegistry", "requestMaintenancePanel", [1n, 1]),
    ).rejects.toThrow();
    await write(owner, addresses.taskRegistry, "TaskRegistry", "requestMaintenancePanel", [1n, 1]);
    const pendingMaintenance = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(pendingMaintenance[19]).toBe(4);
    await finalizeRequestedTester(1n);
    await completeVerificationPanel(1n, false, []);
    expect(await read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [executor.account!.address, 1])).toMatchObject({ scoreBps: 4_700, outcomeCount: 2 });
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
    const repairPanel = (await read(addresses.taskRegistry, "TaskRegistry", "getTaskTesters", [1n])) as Address[];
    const frozenRepairPanel = (await read(addresses.verificationPanel, "VerificationPanel", "getPanel", [1n])) as { qualityMultipliersBps: number[] };
    expect(repairPanel.map((address) => address.toLowerCase())).toContain(repairTester.account!.address.toLowerCase());
    await completeVerificationPanel(1n, true, [10_000]);
    const repairedTask = (await read(addresses.taskRegistry, "TaskRegistry", "tasks", [1n])) as readonly unknown[];
    expect(repairedTask[7]).toBe(repairedArtifact);
    expect(repairedTask[19]).toBe(8);
    const repairedCheckpoint = (await read(addresses.rewardVault, "RewardVault", "getCheckpointTesterPanel", [1n, 1])) as [Address[], number[]];
    expect(repairedCheckpoint[0].map((address) => address.toLowerCase())).toEqual(repairPanel.map((address) => address.toLowerCase()));
    const qualityAfter = await Promise.all(repairPanel.map((address) => read(addresses.agentRegistry, "AgentRegistry", "qualityOf", [address, 2]) as Promise<{ scoreBps: number; outcomeCount: number }>));
    qualityAfter.forEach((quality) => {
      expect(quality.outcomeCount).toBeGreaterThan(0);
    });
    const rawQualityWeights = frozenRepairPanel.qualityMultipliersBps.map((multiplier, index) => [4_000, 3_333, 2_667][index] * Number(multiplier));
    const rawTotal = rawQualityWeights.reduce((sum, value) => sum + value, 0);
    const expectedQualityWeights = rawQualityWeights.map((value) => Math.floor(value * 10_000 / rawTotal));
    expectedQualityWeights[0] += 10_000 - expectedQualityWeights.reduce((sum, value) => sum + value, 0);
    expect(repairedCheckpoint[1].map(Number)).toEqual(expectedQualityWeights);
    const originalCheckpoint = (await read(addresses.rewardVault, "RewardVault", "getCheckpointParticipants", [1n, 0])) as [Address[], number[], Address];
    expect(originalCheckpoint).toEqual([[executor.account!.address], [10_000], initialPanel[0]]);
    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 0]);
    await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, 1]);
    for (const checkpoint of [2, 3] as const) {
      await write(owner, addresses.taskRegistry, "TaskRegistry", "requestMaintenancePanel", [1n, checkpoint]);
      await finalizeRequestedTester(1n);
      await completeVerificationPanel(1n, true, [10_000]);
      await write(owner, addresses.rewardVault, "RewardVault", "claim", [1n, checkpoint]);
    }

    const position = (await read(addresses.stakeManager, "StakeCreditManager", "positions", [4n])) as readonly unknown[];
    expect(position[2]).toBe(0n);
    // The evicted executor receives no maintenance reward; all three future
    // 38-token Agent-pool tranches use the replacement's independently tested weight.
    expect(await read(addresses.token, "TestToken", "balanceOf", [executor.account!.address])).toBe(parseEther("9060.8"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [replacement.account!.address])).toBe(parseEther("9091.2"));
    const finalGrant = (await read(addresses.rewardVault, "RewardVault", "getGrant", [1n])) as { claimed: boolean[] };
    expect(finalGrant.claimed).toEqual([true, true, true, true]);
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
    await registerTesterPool(6n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("artifact"))]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, keccak256(stringToHex("artifact"))]);
    await assignTester(1n);
    await completeVerificationPanel(1n, true, [10_000]);
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
    await registerTesterPool(6n);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "claimTask", [1n]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitContribution", [1n, keccak256(stringToHex("artifact"))]);
    await write(executor, addresses.taskRegistry, "TaskRegistry", "submitWork", [1n, keccak256(stringToHex("artifact"))]);
    await assignTester(1n);
    await completeVerificationPanel(1n, true, [10_000]);
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
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("995"));
    await expect(write(arbitratorA, resolver, "DisputeResolver", "vote", [1n, true, resolution])).rejects.toThrow();
    await write(arbitratorB, resolver, "DisputeResolver", "vote", [1n, true, competingResolution]);
    await write(arbitratorC, resolver, "DisputeResolver", "vote", [1n, false, publisherResolution]);
    expect(await read(resolver, "DisputeResolver", "resolved", [1n])).toBe(false);
    await write(arbitratorC, resolver, "DisputeResolver", "changeVote", [1n, true, resolution]);
    expect(await read(addresses.stakeManager, "StakeCreditManager", "stakeOf", [4n])).toBe(parseEther("935.75"));
    expect(await read(addresses.token, "TestToken", "balanceOf", [addresses.rewardVault])).toBe(parseEther("100043.8"));
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
