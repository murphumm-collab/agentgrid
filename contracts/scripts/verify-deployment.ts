import fs, { constants as fsConstants } from "node:fs";
import path from "node:path";
import {
  createPublicClient, getAddress, parseAbi, parseEther, type Hash,
} from "viem";
import { bscTestnet } from "viem/chains";
import { z } from "zod";
import { compileContracts } from "./compiler";
import { verifyRuntimeBytecode } from "./bytecode-verification";
import { publicBscRpcTransport } from "./pilot-policy";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => getAddress(value));
const transactionSchema = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  blockNumber: z.string().regex(/^\d+$/),
  gasUsed: z.string().regex(/^\d+$/),
  status: z.literal("success"),
  contractAddress: addressSchema.optional(),
}).strict();
const deploymentSchema = z.object({
  chainId: z.literal(97), owner: addressSchema, coordinator: addressSchema, reserve: addressSchema,
  daoTreasury: addressSchema, securityReserve: addressSchema,
  arbitrators: z.array(addressSchema).min(3), arbitratorQuorum: z.number().int().min(2),
  startBlock: z.string().regex(/^\d+$/), confirmations: z.literal(5),
  contracts: z.object({
    token: addressSchema, stakeManager: addressSchema, agentRegistry: addressSchema,
    rewardVault: addressSchema, taskRegistry: addressSchema, verificationPanel: addressSchema, verificationArbitrationCourt: addressSchema, disputeResolver: addressSchema, protocolEconomics: addressSchema,
  }).strict(),
  transactions: z.record(z.string(), transactionSchema),
}).passthrough();

const requiredTransactions = [
  "deploy.token", "deploy.stakeManager", "deploy.agentRegistry", "deploy.rewardVault", "deploy.taskRegistry", "deploy.protocolEconomics", "deploy.verificationPanel", "deploy.verificationArbitrationCourt", "deploy.disputeResolver",
  "wire.stakeManager", "wire.agentSelectionRequester", "wire.disputeResolver", "wire.verificationPanel", "wire.rewardVaultVerificationPanel", "wire.verificationArbitrationCourt", "wire.qualitySlasher", "wire.rewardVault", "wire.protocolEconomics", "wire.stakeManagerEconomics", "wire.rewardVaultEconomics", "wire.taskRegistryEconomics", "wire.agentQualityReporter", "wire.arbitrationQualityReporter", "fund.rewardReserve",
  "ownership.TestToken", "ownership.StakeCreditManager", "ownership.RewardVault", "ownership.TaskRegistry", "ownership.DisputeResolver", "ownership.ProtocolEconomics",
] as const;
const deploymentContractByTransaction = {
  "deploy.token": "token", "deploy.stakeManager": "stakeManager", "deploy.agentRegistry": "agentRegistry",
  "deploy.rewardVault": "rewardVault", "deploy.taskRegistry": "taskRegistry", "deploy.disputeResolver": "disputeResolver",
  "deploy.protocolEconomics": "protocolEconomics",
  "deploy.verificationPanel": "verificationPanel", "deploy.verificationArbitrationCourt": "verificationArbitrationCourt",
} as const;

function deploymentFilePath() {
  const explicit = process.env.BSC_TESTNET_DEPLOYMENT_FILE;
  const pilot = process.env.PILOT_DEPLOYMENT_FILE;
  if (explicit && pilot && path.resolve(explicit) !== path.resolve(pilot)) throw new Error("DEPLOYMENT_FILE_CONFIGURATION_CONFLICT");
  return path.resolve(explicit ?? pilot ?? path.join("contracts", "deployments", "bsc-testnet.json"));
}

function readDeploymentFile(filename: string) {
  let descriptor: number;
  try { descriptor = fs.openSync(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("BSC_TESTNET_DEPLOYMENT_FILE_MISSING");
    throw error;
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) throw new Error("BSC_TESTNET_DEPLOYMENT_FILE_SIZE_INVALID");
    if ((stat.mode & 0o077) !== 0) throw new Error("BSC_TESTNET_DEPLOYMENT_FILE_PERMISSIONS_INVALID");
    return deploymentSchema.parse(JSON.parse(fs.readFileSync(descriptor, "utf8")));
  } finally { fs.closeSync(descriptor); }
}

const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function runDeploymentVerification() {
  const filename = deploymentFilePath();
  const deployment = readDeploymentFile(filename);
  if (deployment.arbitratorQuorum > deployment.arbitrators.length) throw new Error("ARBITRATOR_QUORUM_INVALID");
  const roleSet = [deployment.owner, deployment.coordinator, ...deployment.arbitrators].map((value) => value.toLowerCase());
  if (new Set(roleSet).size !== roleSet.length) throw new Error("PROTOCOL_ROLES_NOT_SEPARATED");
  if (requiredTransactions.some((label) => !deployment.transactions[label])) throw new Error("DEPLOYMENT_TRANSACTION_SET_INCOMPLETE");
  if (Object.keys(deployment.transactions).length !== requiredTransactions.length) throw new Error("DEPLOYMENT_TRANSACTION_SET_UNEXPECTED");

  const artifacts = compileContracts();
  const client = createPublicClient({ chain: bscTestnet, transport: publicBscRpcTransport(process.env.BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-dataseed.bnbchain.org") });
  if (await client.getChainId() !== bscTestnet.id) throw new Error("DEPLOYMENT_CHAIN_MISMATCH");
  const head = await client.getBlockNumber();
  const receipts = await Promise.all(requiredTransactions.map(async (label) => {
    const recorded = deployment.transactions[label]!;
    const receipt = await client.getTransactionReceipt({ hash: recorded.hash as Hash });
    if (receipt.status !== "success" || receipt.blockNumber.toString() !== recorded.blockNumber || receipt.gasUsed.toString() !== recorded.gasUsed) {
      throw new Error(`DEPLOYMENT_TRANSACTION_RECEIPT_MISMATCH_${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`);
    }
    if (head < receipt.blockNumber + 4n) throw new Error("DEPLOYMENT_TRANSACTION_CONFIRMATIONS_INSUFFICIENT");
    const contractKey = deploymentContractByTransaction[label as keyof typeof deploymentContractByTransaction];
    if (contractKey && (!receipt.contractAddress || !equal(receipt.contractAddress, deployment.contracts[contractKey]))) {
      throw new Error(`DEPLOYMENT_CONTRACT_RECEIPT_MISMATCH_${contractKey.toUpperCase()}`);
    }
    return receipt;
  }));
  const firstDeploymentBlock = receipts.slice(0, 9).reduce((minimum, receipt) => receipt.blockNumber < minimum ? receipt.blockNumber : minimum, receipts[0]!.blockNumber);
  if (BigInt(deployment.startBlock) !== firstDeploymentBlock) throw new Error("DEPLOYMENT_START_BLOCK_MISMATCH");

  const artifactNames = {
    token: "TestToken", stakeManager: "StakeCreditManager", agentRegistry: "AgentRegistry",
    rewardVault: "RewardVault", taskRegistry: "TaskRegistry", verificationPanel: "VerificationPanel", verificationArbitrationCourt: "VerificationArbitrationCourt", disputeResolver: "DisputeResolver", protocolEconomics: "ProtocolEconomics",
  } as const;
  for (const [name, address] of Object.entries(deployment.contracts)) {
    const code = await client.getCode({ address });
    verifyRuntimeBytecode(name, code, artifacts[artifactNames[name as keyof typeof artifactNames]]);
  }

  const stakeAbi = parseAbi(["function taskRegistry() view returns(address)", "function protocolEconomics() view returns(address)", "function qualitySlasher() view returns(address)"]);
  const vaultAbi = parseAbi(["function taskRegistry() view returns(address)", "function verificationPanel() view returns(address)", "function protocolEconomics() view returns(address)"]);
  const taskAbi = parseAbi(["function coordinator() view returns(address)", "function disputeResolver() view returns(address)", "function agentRegistry() view returns(address)", "function verificationPanel() view returns(address)", "function protocolEconomics() view returns(address)"]);
  const agentAbi = parseAbi(["function stakeManager() view returns(address)", "function selectionRequester() view returns(address)", "function outcomeReporterRoles(address) view returns(uint8)"]);
  const resolverAbi = parseAbi(["function registry() view returns(address)", "function quorum() view returns(uint256)", "function isArbitrator(address) view returns(bool)"]);
  const tokenAbi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
  const ownableAbi = parseAbi(["function owner() view returns(address)"]);
  const panelAbi = parseAbi(["function registry() view returns(address)", "function rewardVault() view returns(address)", "function qualityRegistry() view returns(address)", "function arbitrationCourt() view returns(address)"]);
  const courtAbi = parseAbi(["function token() view returns(address)", "function panel() view returns(address)", "function agentRegistry() view returns(address)", "function stakeManager() view returns(address)", "function reserve() view returns(address)", "function isArbitrator(address) view returns(bool)"]);
  const economicsAbi = parseAbi(["function taskRegistry() view returns(address)", "function stakeManager() view returns(address)", "function rewardVault() view returns(address)", "function daoTreasury() view returns(address)", "function securityReserve() view returns(address)", "function burnSink() view returns(address)", "function vestingDuration() view returns(uint32)"]);
  const [stakeRegistry, stakeEconomics, stakeQualitySlasher, vaultRegistry, vaultPanel, vaultEconomics, coordinator, disputeResolver, taskAgentRegistry, taskPanel, taskEconomics, agentStakeManager, selectionRequester, qualityReporterRoles, courtQualityReporterRoles, resolverRegistry, quorum, reserveBalance, arbitratorChecks, panelRegistry, panelVault, panelQualityRegistry, panelCourt, courtToken, courtPanel, courtAgentRegistry, courtStakeManager, courtReserve, courtArbitrators, economicsRegistry, economicsStake, economicsVault, economicsDao, economicsSecurity, economicsBurn, economicsVesting] = await Promise.all([
    client.readContract({ address: deployment.contracts.stakeManager, abi: stakeAbi, functionName: "taskRegistry" }),
    client.readContract({ address: deployment.contracts.stakeManager, abi: stakeAbi, functionName: "protocolEconomics" }),
    client.readContract({ address: deployment.contracts.stakeManager, abi: stakeAbi, functionName: "qualitySlasher" }),
    client.readContract({ address: deployment.contracts.rewardVault, abi: vaultAbi, functionName: "taskRegistry" }),
    client.readContract({ address: deployment.contracts.rewardVault, abi: vaultAbi, functionName: "verificationPanel" }),
    client.readContract({ address: deployment.contracts.rewardVault, abi: vaultAbi, functionName: "protocolEconomics" }),
    client.readContract({ address: deployment.contracts.taskRegistry, abi: taskAbi, functionName: "coordinator" }),
    client.readContract({ address: deployment.contracts.taskRegistry, abi: taskAbi, functionName: "disputeResolver" }),
    client.readContract({ address: deployment.contracts.taskRegistry, abi: taskAbi, functionName: "agentRegistry" }),
    client.readContract({ address: deployment.contracts.taskRegistry, abi: taskAbi, functionName: "verificationPanel" }),
    client.readContract({ address: deployment.contracts.taskRegistry, abi: taskAbi, functionName: "protocolEconomics" }),
    client.readContract({ address: deployment.contracts.agentRegistry, abi: agentAbi, functionName: "stakeManager" }),
    client.readContract({ address: deployment.contracts.agentRegistry, abi: agentAbi, functionName: "selectionRequester" }),
    client.readContract({ address: deployment.contracts.agentRegistry, abi: agentAbi, functionName: "outcomeReporterRoles", args: [deployment.contracts.verificationPanel] }),
    client.readContract({ address: deployment.contracts.agentRegistry, abi: agentAbi, functionName: "outcomeReporterRoles", args: [deployment.contracts.verificationArbitrationCourt] }),
    client.readContract({ address: deployment.contracts.disputeResolver, abi: resolverAbi, functionName: "registry" }),
    client.readContract({ address: deployment.contracts.disputeResolver, abi: resolverAbi, functionName: "quorum" }),
    client.readContract({ address: deployment.contracts.token, abi: tokenAbi, functionName: "balanceOf", args: [deployment.contracts.rewardVault] }),
    Promise.all(deployment.arbitrators.map((address) => client.readContract({ address: deployment.contracts.disputeResolver, abi: resolverAbi, functionName: "isArbitrator", args: [address] }))),
    client.readContract({ address: deployment.contracts.verificationPanel, abi: panelAbi, functionName: "registry" }),
    client.readContract({ address: deployment.contracts.verificationPanel, abi: panelAbi, functionName: "rewardVault" }),
    client.readContract({ address: deployment.contracts.verificationPanel, abi: panelAbi, functionName: "qualityRegistry" }),
    client.readContract({ address: deployment.contracts.verificationPanel, abi: panelAbi, functionName: "arbitrationCourt" }),
    client.readContract({ address: deployment.contracts.verificationArbitrationCourt, abi: courtAbi, functionName: "token" }),
    client.readContract({ address: deployment.contracts.verificationArbitrationCourt, abi: courtAbi, functionName: "panel" }),
    client.readContract({ address: deployment.contracts.verificationArbitrationCourt, abi: courtAbi, functionName: "agentRegistry" }),
    client.readContract({ address: deployment.contracts.verificationArbitrationCourt, abi: courtAbi, functionName: "stakeManager" }),
    client.readContract({ address: deployment.contracts.verificationArbitrationCourt, abi: courtAbi, functionName: "reserve" }),
    Promise.all(deployment.arbitrators.slice(0, 3).map((address) => client.readContract({ address: deployment.contracts.verificationArbitrationCourt, abi: courtAbi, functionName: "isArbitrator", args: [address] }))),
    client.readContract({ address: deployment.contracts.protocolEconomics, abi: economicsAbi, functionName: "taskRegistry" }),
    client.readContract({ address: deployment.contracts.protocolEconomics, abi: economicsAbi, functionName: "stakeManager" }),
    client.readContract({ address: deployment.contracts.protocolEconomics, abi: economicsAbi, functionName: "rewardVault" }),
    client.readContract({ address: deployment.contracts.protocolEconomics, abi: economicsAbi, functionName: "daoTreasury" }),
    client.readContract({ address: deployment.contracts.protocolEconomics, abi: economicsAbi, functionName: "securityReserve" }),
    client.readContract({ address: deployment.contracts.protocolEconomics, abi: economicsAbi, functionName: "burnSink" }),
    client.readContract({ address: deployment.contracts.protocolEconomics, abi: economicsAbi, functionName: "vestingDuration" }),
  ]);
  if (!equal(stakeRegistry, deployment.contracts.taskRegistry) || !equal(stakeQualitySlasher, deployment.contracts.verificationArbitrationCourt) || !equal(vaultRegistry, deployment.contracts.taskRegistry) || !equal(vaultPanel, deployment.contracts.verificationPanel)) throw new Error("REGISTRY_WIRING_INVALID");
  if (!equal(stakeEconomics, deployment.contracts.protocolEconomics) || !equal(vaultEconomics, deployment.contracts.protocolEconomics) || !equal(taskEconomics, deployment.contracts.protocolEconomics) || !equal(economicsRegistry, deployment.contracts.taskRegistry) || !equal(economicsStake, deployment.contracts.stakeManager) || !equal(economicsVault, deployment.contracts.rewardVault) || !equal(economicsDao, deployment.daoTreasury) || !equal(economicsSecurity, deployment.securityReserve) || !equal(economicsBurn, "0x000000000000000000000000000000000000dEaD") || Number(economicsVesting) !== 365 * 24 * 60 * 60) throw new Error("PROTOCOL_ECONOMICS_WIRING_INVALID");
  if (!equal(coordinator, deployment.coordinator) || !equal(disputeResolver, deployment.contracts.disputeResolver) || !equal(resolverRegistry, deployment.contracts.taskRegistry)) throw new Error("ROLE_WIRING_INVALID");
  if (!equal(taskAgentRegistry, deployment.contracts.agentRegistry) || !equal(agentStakeManager, deployment.contracts.stakeManager) || !equal(selectionRequester, deployment.contracts.taskRegistry)) throw new Error("AGENT_REGISTRY_WIRING_INVALID");
  if (!equal(taskPanel, deployment.contracts.verificationPanel) || !equal(panelRegistry, deployment.contracts.taskRegistry) || !equal(panelVault, deployment.contracts.rewardVault) || !equal(panelQualityRegistry, deployment.contracts.agentRegistry) || Number(qualityReporterRoles) !== 7 || Number(courtQualityReporterRoles) !== 7 || !equal(panelCourt, deployment.contracts.verificationArbitrationCourt)
    || !equal(courtToken, deployment.contracts.token) || !equal(courtPanel, deployment.contracts.verificationPanel) || !equal(courtAgentRegistry, deployment.contracts.agentRegistry) || !equal(courtStakeManager, deployment.contracts.stakeManager) || !equal(courtReserve, deployment.reserve) || courtArbitrators.some((value) => !value)) throw new Error("VERIFICATION_PANEL_WIRING_INVALID");
  if (Number(quorum) !== deployment.arbitratorQuorum || arbitratorChecks.some((value) => !value)) throw new Error("ARBITRATION_CONFIGURATION_INVALID");
  if (reserveBalance < parseEther("100000")) throw new Error("REWARD_RESERVE_UNDERFUNDED");
  const ownership = await Promise.all([
    deployment.contracts.token, deployment.contracts.stakeManager, deployment.contracts.rewardVault,
    deployment.contracts.taskRegistry, deployment.contracts.disputeResolver, deployment.contracts.protocolEconomics,
  ].map((address) => client.readContract({ address, abi: ownableAbi, functionName: "owner" })));
  if (ownership.some((address) => !equal(address, deployment.owner))) throw new Error("PROTOCOL_OWNERSHIP_INVALID");

  return {
    verified: true, deploymentFile: filename, runtimeBytecodeVerified: true,
    transactionReceiptsVerified: receipts.length, confirmations: deployment.confirmations,
    chainId: deployment.chainId, contracts: deployment.contracts,
    arbitrators: deployment.arbitrators.length, quorum: Number(quorum), rewardReserve: reserveBalance.toString(),
  };
}

void runDeploymentVerification().then((report) => console.log(JSON.stringify(report))).catch((error) => {
  console.error(error instanceof Error ? error.message : "DEPLOYMENT_VERIFICATION_FAILED");
  process.exitCode = 1;
});
