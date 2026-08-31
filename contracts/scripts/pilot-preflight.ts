import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPublicClient, formatEther, getAddress, http, parseAbi, parseEther, type Address } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { z } from "zod";
import { configuredSecret } from "../../src/lib/secrets";
import { isPrivateNetworkAddress, pilotRoleNames, validateBscTestnetIdentity, validatePilotRoleSeparation, validatePilotRpcUrl, type PilotRoleName } from "./pilot-policy";
import { compileContracts } from "./compiler";
import { verifyRuntimeBytecode } from "./bytecode-verification";

const addressSchema = z.string().transform((value) => getAddress(value));
const deploymentSchema = z.object({
  chainId: z.literal(97), owner: addressSchema, coordinator: addressSchema, reserve: addressSchema,
  arbitrators: z.array(addressSchema).min(3), arbitratorQuorum: z.number().int().min(2),
  startBlock: z.string().regex(/^\d+$/),
  contracts: z.object({
    token: addressSchema, stakeManager: addressSchema, agentRegistry: addressSchema,
    rewardVault: addressSchema, taskRegistry: addressSchema, disputeResolver: addressSchema,
  }).strict(),
}).passthrough().superRefine((deployment, context) => {
  const arbitrators = deployment.arbitrators.map((address) => address.toLowerCase());
  if (new Set(arbitrators).size !== arbitrators.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["arbitrators"], message: "arbitrators must be distinct" });
  }
  if (deployment.arbitratorQuorum > deployment.arbitrators.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["arbitratorQuorum"], message: "quorum exceeds arbitrator count" });
  }
});

export type PilotDeployment = z.infer<typeof deploymentSchema>;
export type PilotAccounts = Record<PilotRoleName, PrivateKeyAccount>;

const roleSecretNames: Record<PilotRoleName, string> = {
  publisher: "PILOT_PUBLISHER_PRIVATE_KEY",
  evaluator1: "PILOT_EVALUATOR_1_PRIVATE_KEY",
  evaluator2: "PILOT_EVALUATOR_2_PRIVATE_KEY",
  evaluator3: "PILOT_EVALUATOR_3_PRIVATE_KEY",
  executor: "PILOT_EXECUTOR_PRIVATE_KEY",
  tester: "PILOT_TESTER_PRIVATE_KEY",
  coordinator: "PROTOCOL_OPERATOR_PRIVATE_KEY",
};

export interface PilotPreflightReport {
  executionReady: boolean;
  checkedAt: string;
  chain?: { chainId: number; genesisHash: string | null; latestBlock: string; latestHash: string | null; headAgeSeconds: number };
  deployment?: { file: string; sha256: string; contractsWithCode: number; runtimeBytecodeVerified: boolean; nextTaskId: string; registeredAgents: string; wiringVerified: boolean };
  roles?: Record<string, { address: Address; balanceTbnb: string }>;
  minimumBalanceTbnb?: string;
  blockers: string[];
}

export interface PilotPreflightContext {
  rpcUrl: string;
  deploymentFile: string;
  deployment: PilotDeployment;
  accounts: PilotAccounts;
  publicClient: ReturnType<typeof createPublicClient>;
}

export async function runPilotPreflight(options: { requirePristine?: boolean; silent?: boolean } = {}) {
  const blockers: string[] = [];
  const report: PilotPreflightReport = { executionReady: false, checkedAt: new Date().toISOString(), blockers };
  const deploymentFile = path.resolve(process.env.PILOT_DEPLOYMENT_FILE ?? path.join("contracts", "deployments", "bsc-testnet.json"));
  if (!fs.existsSync(deploymentFile)) {
    blockers.push("BSC_TESTNET_DEPLOYMENT_FILE_MISSING");
    if (!options.silent) console.log(JSON.stringify(report));
    return { report };
  }

  let deployment: PilotDeployment;
  let deploymentBytes: Buffer;
  try {
    deploymentBytes = fs.readFileSync(deploymentFile);
    deployment = deploymentSchema.parse(JSON.parse(deploymentBytes.toString("utf8")));
  } catch {
    blockers.push("BSC_TESTNET_DEPLOYMENT_FILE_INVALID");
    if (!options.silent) console.log(JSON.stringify(report));
    return { report };
  }

  let rpcUrl: string;
  try { rpcUrl = validatePilotRpcUrl(process.env.BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-dataseed.bnbchain.org"); }
  catch (error) {
    blockers.push(error instanceof Error ? error.message : "PILOT_RPC_INVALID");
    if (!options.silent) console.log(JSON.stringify(report));
    return { report };
  }
  const publicClient = createPublicClient({ chain: bscTestnet, transport: http(rpcUrl) });
  try {
    const resolved = await lookup(new URL(rpcUrl).hostname, { all: true });
    if (!resolved.length || resolved.some((entry) => isPrivateNetworkAddress(entry.address))) throw new Error("PILOT_RPC_DNS_PRIVATE_ADDRESS_FORBIDDEN");
    const [chainId, genesis, latest] = await Promise.all([
      publicClient.getChainId(), publicClient.getBlock({ blockNumber: 0n }), publicClient.getBlock(),
    ]);
    const headAgeSeconds = validateBscTestnetIdentity({ chainId, genesisHash: genesis.hash, latestTimestamp: latest.timestamp });
    report.chain = { chainId, genesisHash: genesis.hash, latestBlock: String(latest.number), latestHash: latest.hash, headAgeSeconds };
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : "PILOT_CHAIN_IDENTITY_FAILED");
  }

  const accounts = {} as PilotAccounts;
  for (const role of pilotRoleNames) {
    const secretName = roleSecretNames[role];
    const secret = configuredSecret(secretName);
    if (!secret.value || secret.value.includes("REPLACE")) { blockers.push(`${secretName}_MISSING`); continue; }
    if (process.env.REQUIRE_FILE_SECRETS === "true" && secret.source !== "file") { blockers.push(`${secretName}_FILE_REQUIRED`); continue; }
    try { accounts[role] = privateKeyToAccount(secret.value as `0x${string}`); }
    catch { blockers.push(`${secretName}_INVALID`); }
  }

  if (pilotRoleNames.every((role) => accounts[role])) {
    try {
      validatePilotRoleSeparation(
        Object.fromEntries(pilotRoleNames.map((role) => [role, accounts[role].address])) as Record<PilotRoleName, Address>,
        [deployment.owner, deployment.reserve, deployment.coordinator, ...deployment.arbitrators],
      );
    } catch (error) { blockers.push(error instanceof Error ? error.message : "PILOT_ROLE_SEPARATION_INVALID"); }
    if (accounts.coordinator.address.toLowerCase() !== deployment.coordinator.toLowerCase()) blockers.push("PILOT_COORDINATOR_KEY_MISMATCH");
  }

  try {
    const artifactNames = { token: "TestToken", stakeManager: "StakeCreditManager", agentRegistry: "AgentRegistry", rewardVault: "RewardVault", taskRegistry: "TaskRegistry", disputeResolver: "DisputeResolver" } as const;
    const compiled = compileContracts();
    const contractEntries = Object.entries(deployment.contracts) as Array<[keyof typeof artifactNames, Address]>;
    const codes = await Promise.all(contractEntries.map(([, address]) => publicClient.getCode({ address })));
    const contractsWithCode = codes.filter((code) => code && code !== "0x").length;
    if (contractsWithCode !== Object.keys(deployment.contracts).length) blockers.push("PILOT_DEPLOYED_BYTECODE_MISSING");
    contractEntries.forEach(([name], index) => verifyRuntimeBytecode(name, codes[index], compiled[artifactNames[name]]));
    const runtimeBytecodeVerified = true;
    const taskAbi = parseAbi(["function nextTaskId() view returns(uint256)", "function coordinator() view returns(address)", "function disputeResolver() view returns(address)", "function agentRegistry() view returns(address)"]);
    const agentAbi = parseAbi(["function agentCount() view returns(uint256)", "function stakeManager() view returns(address)", "function taskRegistry() view returns(address)"]);
    const registryAbi = parseAbi(["function taskRegistry() view returns(address)"]);
    const resolverAbi = parseAbi(["function registry() view returns(address)", "function quorum() view returns(uint256)", "function isArbitrator(address) view returns(bool)"]);
    const tokenAbi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
    const ownableAbi = parseAbi(["function owner() view returns(address)"]);
    const [
      nextTaskId, registeredAgents, onchainCoordinator, disputeResolver, taskAgentRegistry, agentStakeManager, agentTaskRegistry,
      stakeRegistry, stakeAgentRegistry, vaultRegistry, resolverRegistry, resolverQuorum, reserveBalance, arbitratorChecks, ownership,
    ] = await Promise.all([
      publicClient.readContract({ address: deployment.contracts.taskRegistry, abi: taskAbi, functionName: "nextTaskId" }),
      publicClient.readContract({ address: deployment.contracts.agentRegistry, abi: agentAbi, functionName: "agentCount" }),
      publicClient.readContract({ address: deployment.contracts.taskRegistry, abi: taskAbi, functionName: "coordinator" }),
      publicClient.readContract({ address: deployment.contracts.taskRegistry, abi: taskAbi, functionName: "disputeResolver" }),
      publicClient.readContract({ address: deployment.contracts.taskRegistry, abi: taskAbi, functionName: "agentRegistry" }),
      publicClient.readContract({ address: deployment.contracts.agentRegistry, abi: agentAbi, functionName: "stakeManager" }),
      publicClient.readContract({ address: deployment.contracts.agentRegistry, abi: agentAbi, functionName: "taskRegistry" }),
      publicClient.readContract({ address: deployment.contracts.stakeManager, abi: registryAbi, functionName: "taskRegistry" }),
      publicClient.readContract({ address: deployment.contracts.stakeManager, abi: parseAbi(["function agentRegistry() view returns(address)"]), functionName: "agentRegistry" }),
      publicClient.readContract({ address: deployment.contracts.rewardVault, abi: registryAbi, functionName: "taskRegistry" }),
      publicClient.readContract({ address: deployment.contracts.disputeResolver, abi: resolverAbi, functionName: "registry" }),
      publicClient.readContract({ address: deployment.contracts.disputeResolver, abi: resolverAbi, functionName: "quorum" }),
      publicClient.readContract({ address: deployment.contracts.token, abi: tokenAbi, functionName: "balanceOf", args: [deployment.contracts.rewardVault] }),
      Promise.all(deployment.arbitrators.map((address) => publicClient.readContract({ address: deployment.contracts.disputeResolver, abi: resolverAbi, functionName: "isArbitrator", args: [address] }))),
      Promise.all([deployment.contracts.token, deployment.contracts.stakeManager, deployment.contracts.rewardVault, deployment.contracts.taskRegistry, deployment.contracts.disputeResolver]
        .map((address) => publicClient.readContract({ address, abi: ownableAbi, functionName: "owner" }))),
    ]);
    const equal = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
    const wiringVerified =
      equal(onchainCoordinator, deployment.coordinator) && equal(disputeResolver, deployment.contracts.disputeResolver) &&
      equal(taskAgentRegistry, deployment.contracts.agentRegistry) && equal(agentStakeManager, deployment.contracts.stakeManager) && equal(agentTaskRegistry, deployment.contracts.taskRegistry) &&
      equal(stakeRegistry, deployment.contracts.taskRegistry) && equal(stakeAgentRegistry, deployment.contracts.agentRegistry) && equal(vaultRegistry, deployment.contracts.taskRegistry) &&
      equal(resolverRegistry, deployment.contracts.taskRegistry) && Number(resolverQuorum) === deployment.arbitratorQuorum &&
      arbitratorChecks.every(Boolean) && reserveBalance >= parseEther("100000") && ownership.every((owner) => equal(owner, deployment.owner));
    if (!wiringVerified) blockers.push("PILOT_DEPLOYMENT_WIRING_INVALID");
    if (options.requirePristine !== false && (nextTaskId !== 1n || registeredAgents !== 0n)) blockers.push("PILOT_REQUIRES_PRISTINE_DEPLOYMENT");
    report.deployment = {
      file: deploymentFile, sha256: createHash("sha256").update(deploymentBytes).digest("hex"), contractsWithCode, runtimeBytecodeVerified,
      nextTaskId: nextTaskId.toString(), registeredAgents: registeredAgents.toString(), wiringVerified,
    };
  } catch (error) { blockers.push(error instanceof Error ? error.message : "PILOT_DEPLOYMENT_READ_FAILED"); }

  let minimumBalance = parseEther("0.02");
  try { minimumBalance = parseEther(process.env.PILOT_MIN_TBNB ?? "0.02"); }
  catch { blockers.push("PILOT_MIN_TBNB_INVALID"); }
  report.minimumBalanceTbnb = formatEther(minimumBalance);
  if (pilotRoleNames.every((role) => accounts[role])) {
    const balances = await Promise.all(pilotRoleNames.map((role) => publicClient.getBalance({ address: accounts[role].address })));
    report.roles = Object.fromEntries(pilotRoleNames.map((role, index) => [role, { address: accounts[role].address, balanceTbnb: formatEther(balances[index]) }]));
    pilotRoleNames.forEach((role, index) => { if (balances[index] < minimumBalance) blockers.push(`PILOT_${role.toUpperCase()}_TBNB_UNDERFUNDED`); });
  }

  report.executionReady = blockers.length === 0;
  if (!options.silent) console.log(JSON.stringify(report));
  const context: PilotPreflightContext | undefined = report.executionReady ? { rpcUrl, deploymentFile, deployment, accounts, publicClient } : undefined;
  return { report, context };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runPilotPreflight({ requirePristine: true }).then(({ report }) => { if (!report.executionReady) process.exitCode = 2; });
}
