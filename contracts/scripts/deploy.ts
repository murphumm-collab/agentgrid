import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient, createWalletClient, formatEther, getAddress, parseEther,
  type Abi, type Address, type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { compileContracts, solidityCompilerVersion } from "./compiler";
import { runtimeBytecodeHash } from "./bytecode-verification";
import {
  deploymentConfigurationSha256, deploymentRunStatePath, newDeploymentRunState,
  readDeploymentRunState, saveDeploymentRunState,
} from "./deployment-run-state";
import { requiredConfigValue, requiredSecret } from "../../src/lib/secrets";
import { publicBscRpcTransport } from "./pilot-policy";

const ACKNOWLEDGEMENT = "I_UNDERSTAND_THIS_BROADCASTS_BSC_TESTNET_TRANSACTIONS";
const contractKeys = ["token", "stakeManager", "agentRegistry", "rewardVault", "taskRegistry", "competitionSlotPassRegistry", "verificationPanel", "verificationArbitrationCourt", "disputeResolver", "protocolEconomics"] as const;
type ContractKey = typeof contractKeys[number];

async function main() {
  if (process.env.DEPLOYMENT_BROADCAST_ACK !== ACKNOWLEDGEMENT) throw new Error("DEPLOYMENT_BROADCAST_ACK_REQUIRED");

  const outputPath = path.resolve(process.cwd(), "contracts", "deployments", "bsc-testnet.json");
  if (fs.existsSync(outputPath)) throw new Error("BSC_TESTNET_DEPLOYMENT_FILE_ALREADY_EXISTS");

  const rpcUrl = requiredConfigValue("BSC_TESTNET_RPC_URL");
  const privateKey = requiredSecret("DEPLOYER_PRIVATE_KEY") as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  const transport = publicBscRpcTransport(rpcUrl);
  const publicClient = createPublicClient({ chain: bscTestnet, transport });
  const walletClient = createWalletClient({ account, chain: bscTestnet, transport });
  const artifacts = compileContracts();

  const actualChainId = await publicClient.getChainId();
  if (actualChainId !== bscTestnet.id) throw new Error(`WRONG_CHAIN_${actualChainId}`);
  let minimumDeployerBalance: bigint;
  try { minimumDeployerBalance = parseEther(process.env.DEPLOYER_MIN_TBNB ?? "0.1"); }
  catch { throw new Error("DEPLOYER_MIN_TBNB_INVALID"); }
  const deployerBalance = await publicClient.getBalance({ address: account.address });
  if (deployerBalance < minimumDeployerBalance) throw new Error("DEPLOYER_TBNB_UNDERFUNDED");

  const deployer = account.address;
  const owner = getAddress(requiredConfigValue("PROTOCOL_OWNER_ADDRESS"));
  const reserve = getAddress(process.env.PROTOCOL_RESERVE_ADDRESS ?? deployer);
  const daoTreasury = getAddress(requiredConfigValue("PROTOCOL_DAO_TREASURY_ADDRESS"));
  const securityReserve = getAddress(requiredConfigValue("PROTOCOL_SECURITY_RESERVE_ADDRESS"));
  const coordinator = getAddress(requiredConfigValue("PROTOCOL_COORDINATOR_ADDRESS"));
  const competitionSlotPassIssuer = getAddress(requiredConfigValue("COMPETITION_SLOT_PASS_ISSUER_ADDRESS"));
  if (competitionSlotPassIssuer === "0x0000000000000000000000000000000000000000") throw new Error("COMPETITION_SLOT_PASS_ISSUER_ADDRESS_REQUIRED");
  if (owner.toLowerCase() === coordinator.toLowerCase()) throw new Error("OWNER_AND_COORDINATOR_MUST_DIFFER");
  const arbitrators = (process.env.ARBITRATOR_ADDRESSES ?? "").split(",").map((value) => value.trim()).filter(Boolean).map((value) => getAddress(value));
  if (arbitrators.length < 3) throw new Error("THREE_ARBITRATORS_REQUIRED");
  if (new Set(arbitrators.map((value) => value.toLowerCase())).size !== arbitrators.length) throw new Error("ARBITRATORS_MUST_BE_DISTINCT");
  if (arbitrators.some((address) => [owner, coordinator].some((role) => role.toLowerCase() === address.toLowerCase()))) {
    throw new Error("ARBITRATORS_MUST_DIFFER_FROM_OWNER_AND_COORDINATOR");
  }
  const quorum = Number(process.env.ARBITRATOR_QUORUM ?? 2);
  if (!Number.isInteger(quorum) || quorum < 2 || quorum > arbitrators.length) throw new Error("ARBITRATOR_QUORUM_INVALID");

  const runtimeBytecodeHashes = Object.fromEntries(
    ["TestToken", "StakeCreditManager", "AgentRegistry", "RewardVault", "TaskRegistry", "CompetitionSlotPassRegistry", "VerificationPanel", "VerificationArbitrationCourt", "DisputeResolver", "ProtocolEconomics"]
      .map((name) => [name, runtimeBytecodeHash(artifacts[name])]),
  );
  const configuration = {
    chainId: bscTestnet.id,
    compilerVersion: solidityCompilerVersion(),
    deployer,
    owner,
    coordinator,
    competitionSlotPassIssuer,
    reserve,
    daoTreasury,
    securityReserve,
    arbitrators,
    arbitratorQuorum: quorum,
    runtimeBytecodeHashes,
  };
  const configurationSha256 = deploymentConfigurationSha256(configuration);
  const runFile = deploymentRunStatePath();
  const runFileExists = fs.existsSync(runFile);
  const state = runFileExists ? readDeploymentRunState(runFile) : newDeploymentRunState(configurationSha256);
  if (state.configurationSha256 !== configurationSha256) throw new Error("DEPLOYMENT_RESUME_CONFIGURATION_MISMATCH");
  if (state.completedAt) throw new Error("DEPLOYMENT_RUN_ALREADY_COMPLETED");
  if (!runFileExists) saveDeploymentRunState(runFile, state);

  async function receipt(label: string, send: () => Promise<Hash>) {
    let recorded = state.transactions[label];
    if (!recorded) {
      recorded = { hash: await send() };
      state.transactions[label] = recorded;
      saveDeploymentRunState(runFile, state);
    }
    const confirmed = await publicClient.waitForTransactionReceipt({ hash: recorded.hash as Hash, confirmations: 5 });
    recorded.blockNumber = confirmed.blockNumber.toString();
    recorded.gasUsed = confirmed.gasUsed.toString();
    recorded.status = confirmed.status;
    if (confirmed.contractAddress) recorded.contractAddress = confirmed.contractAddress;
    saveDeploymentRunState(runFile, state);
    if (confirmed.status !== "success") throw new Error(`DEPLOYMENT_TRANSACTION_REVERTED_${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`);
    return confirmed;
  }

  async function deploy(label: string, key: ContractKey, name: string, args: readonly unknown[]) {
    const confirmed = await receipt(label, () => walletClient.deployContract({
      abi: artifacts[name].abi as Abi,
      bytecode: artifacts[name].bytecode,
      args,
    } as never));
    if (!confirmed.contractAddress) throw new Error(`DEPLOYMENT_CONTRACT_ADDRESS_MISSING_${key.toUpperCase()}`);
    const existing = state.contracts[key];
    if (existing && existing.toLowerCase() !== confirmed.contractAddress.toLowerCase()) throw new Error("DEPLOYMENT_RESUME_ADDRESS_MISMATCH");
    state.contracts[key] = confirmed.contractAddress;
    const currentStart = state.startBlock ? BigInt(state.startBlock) : undefined;
    if (currentStart === undefined || confirmed.blockNumber < currentStart) state.startBlock = confirmed.blockNumber.toString();
    saveDeploymentRunState(runFile, state);
    return confirmed.contractAddress;
  }

  async function write(label: string, address: Address, contractName: string, functionName: string, args: readonly unknown[]) {
    return receipt(label, () => walletClient.writeContract({
      address,
      abi: artifacts[contractName].abi as Abi,
      functionName,
      args,
    } as never));
  }

  const token = await deploy("deploy.token", "token", "TestToken", [deployer]);
  const stakeManager = await deploy("deploy.stakeManager", "stakeManager", "StakeCreditManager", [token, deployer]);
  const agentRegistry = await deploy("deploy.agentRegistry", "agentRegistry", "AgentRegistry", [stakeManager]);
  const rewardVault = await deploy("deploy.rewardVault", "rewardVault", "RewardVault", [token, reserve, parseEther("100000"), deployer]);
  const taskRegistry = await deploy("deploy.taskRegistry", "taskRegistry", "TaskRegistry", [stakeManager, rewardVault, agentRegistry, coordinator, deployer]);
  const competitionSlotPassRegistry = await deploy("deploy.competitionSlotPassRegistry", "competitionSlotPassRegistry", "CompetitionSlotPassRegistry", [taskRegistry, competitionSlotPassIssuer, deployer]);
  const protocolEconomics = await deploy("deploy.protocolEconomics", "protocolEconomics", "ProtocolEconomics", [
    token, rewardVault, daoTreasury, securityReserve,
    "0x000000000000000000000000000000000000dEaD", 365 * 24 * 60 * 60, deployer,
  ]);
  const verificationPanel = await deploy("deploy.verificationPanel", "verificationPanel", "VerificationPanel", [taskRegistry, rewardVault, agentRegistry, deployer]);
  const verificationArbitrationCourt = await deploy("deploy.verificationArbitrationCourt", "verificationArbitrationCourt", "VerificationArbitrationCourt", [token, verificationPanel, agentRegistry, reserve, arbitrators.slice(0, 3)]);
  const disputeResolver = await deploy("deploy.disputeResolver", "disputeResolver", "DisputeResolver", [taskRegistry, arbitrators, quorum, deployer]);

  await write("wire.stakeManager", stakeManager, "StakeCreditManager", "setTaskRegistry", [taskRegistry]);
  await write("wire.agentSelectionRequester", agentRegistry, "AgentRegistry", "setSelectionRequester", [taskRegistry]);
  await write("wire.disputeResolver", taskRegistry, "TaskRegistry", "setDisputeResolver", [disputeResolver]);
  await write("wire.verificationPanel", taskRegistry, "TaskRegistry", "setVerificationPanel", [verificationPanel]);
  await write("wire.rewardVaultVerificationPanel", rewardVault, "RewardVault", "setVerificationPanel", [verificationPanel]);
  await write("wire.verificationArbitrationCourt", verificationPanel, "VerificationPanel", "setArbitrationCourt", [verificationArbitrationCourt]);
  await write("wire.qualitySlasher", stakeManager, "StakeCreditManager", "setQualitySlasher", [verificationArbitrationCourt]);
  await write("wire.rewardVault", rewardVault, "RewardVault", "setTaskRegistry", [taskRegistry]);
  await write("wire.protocolEconomics", protocolEconomics, "ProtocolEconomics", "configureProtocol", [taskRegistry, stakeManager]);
  await write("wire.stakeManagerEconomics", stakeManager, "StakeCreditManager", "setProtocolEconomics", [protocolEconomics]);
  await write("wire.rewardVaultEconomics", rewardVault, "RewardVault", "setProtocolEconomics", [protocolEconomics]);
  await write("wire.taskRegistryEconomics", taskRegistry, "TaskRegistry", "setProtocolEconomics", [protocolEconomics]);
  await write("wire.competitionSlotPassRegistry", taskRegistry, "TaskRegistry", "setCompetitionSlotPassRegistry", [competitionSlotPassRegistry]);
  await write("wire.agentQualityReporter", agentRegistry, "AgentRegistry", "setOutcomeReporter", [verificationPanel, 7]);
  await write("wire.arbitrationQualityReporter", agentRegistry, "AgentRegistry", "setOutcomeReporter", [verificationArbitrationCourt, 7]);
  await write("fund.rewardReserve", token, "TestToken", "mintRewardReserve", [rewardVault, parseEther("100000")]);
  for (const [name, address] of Object.entries({ TestToken: token, StakeCreditManager: stakeManager, RewardVault: rewardVault, TaskRegistry: taskRegistry, CompetitionSlotPassRegistry: competitionSlotPassRegistry, DisputeResolver: disputeResolver, ProtocolEconomics: protocolEconomics })) {
    await write(`ownership.${name}`, address as Address, name, "transferOwnership", [owner]);
  }

  const contracts = { token, stakeManager, agentRegistry, rewardVault, taskRegistry, competitionSlotPassRegistry, verificationPanel, verificationArbitrationCourt, disputeResolver, protocolEconomics };
  if (contractKeys.some((key) => !state.contracts[key])) throw new Error("DEPLOYMENT_CONTRACT_SET_INCOMPLETE");
  const deployment = {
    ...configuration,
    deployedAt: new Date().toISOString(),
    deployerBalanceTbnbAtStart: formatEther(deployerBalance),
    minimumDeployerBalanceTbnb: formatEther(minimumDeployerBalance),
    startBlock: state.startBlock,
    contracts,
    transactions: state.transactions,
    confirmations: 5,
    deploymentRunFile: runFile,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  state.completedAt = new Date().toISOString();
  saveDeploymentRunState(runFile, state);
  console.log(JSON.stringify({ deployed: true, deploymentFile: outputPath, runFile, chainId: bscTestnet.id, contracts, transactions: Object.keys(state.transactions).length }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "DEPLOYMENT_FAILED");
  process.exitCode = 1;
});
