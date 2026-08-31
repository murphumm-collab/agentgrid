"use client";

import { createPublicClient, createWalletClient, custom, decodeEventLog, keccak256, parseEther, stringToHex, type EIP1193Provider, type Hash, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { agentRegistryAbi, rewardVaultAbi, stakeManagerAbi, taskRegistryAbi, tokenAbi } from "./contracts";
import { loadBrowserChainConfig } from "./browser-chain-config";
import { browserWalletProvider } from "./browser-wallet";

declare global { interface Window { ethereum?: EIP1193Provider } }

export async function registerAgentPosition(positionId: bigint, capabilities: number = 7) {
  const { account, wallet, publicClient, contracts, confirmations } = await clients();
  const hash = await wallet.writeContract({ account, address: contracts.agentRegistry, abi: agentRegistryAbi, functionName: "registerWithCapabilities", args: [positionId, capabilities] });
  await confirmed(hash, publicClient, confirmations);
  return { account, hash };
}

async function clients() {
  const { contracts, confirmations } = await loadBrowserChainConfig();
  const provider = browserWalletProvider();
  const wallet = createWalletClient({ chain: bscTestnet, transport: custom(provider) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("WALLET_NOT_CONNECTED");
  if (await wallet.getChainId() !== bscTestnet.id) await wallet.switchChain({ id: bscTestnet.id });
  return { account, wallet, publicClient: createPublicClient({ chain: bscTestnet, transport: custom(provider) }), contracts, confirmations };
}

async function confirmed(hash: Hash, publicClient: Awaited<ReturnType<typeof clients>>["publicClient"], confirmations: number) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations });
  if (receipt.status !== "success") throw new Error("TRANSACTION_REVERTED");
  return receipt;
}

export async function createStakeAndCredit(amount: string) {
  const { account, wallet, publicClient, contracts, confirmations } = await clients();
  const value = parseEther(amount);
  const allowance = await publicClient.readContract({ address: contracts.token, abi: tokenAbi, functionName: "allowance", args: [account, contracts.stakeManager] });
  if (allowance < value) await confirmed(await wallet.writeContract({ account, address: contracts.token, abi: tokenAbi, functionName: "approve", args: [contracts.stakeManager, value] }), publicClient, confirmations);
  const receipt = await confirmed(await wallet.writeContract({ account, address: contracts.stakeManager, abi: stakeManagerAbi, functionName: "createPosition", args: [value] }), publicClient, confirmations);
  const created = receipt.logs.map((log) => {
    try { return decodeEventLog({ abi: stakeManagerAbi, eventName: "PositionCreated", data: log.data, topics: log.topics }); } catch { return undefined; }
  }).find(Boolean);
  const positionId = created?.args.positionId;
  if (positionId === undefined) throw new Error("POSITION_EVENT_NOT_FOUND");
  const creditHash = await wallet.writeContract({ account, address: contracts.stakeManager, abi: stakeManagerAbi, functionName: "issueCredit", args: [positionId] });
  await confirmed(creditHash, publicClient, confirmations);
  return { positionId: positionId.toString(), transactionHash: receipt.transactionHash, creditTransactionHash: creditHash };
}

export async function waitForBrowserTransaction(hash: Hash) {
  const { confirmations } = await loadBrowserChainConfig();
  const provider = browserWalletProvider();
  const publicClient = createPublicClient({ chain: bscTestnet, transport: custom(provider) });
  await confirmed(hash, publicClient, confirmations);
  return hash;
}

export async function publishCommittedTask(
  input: { positionId: bigint; specHash: Hex; requestedReward: string; maxExecutors: number; executionMode: "COLLABORATION" | "COMPETITION"; requiredTesterCapabilities: number },
  onSubmitted?: (hash: Hash) => void,
) {
  const { account, wallet, publicClient, contracts, confirmations } = await clients();
  const hash = await wallet.writeContract({
    account, address: contracts.taskRegistry, abi: taskRegistryAbi, functionName: "createTaskWithModeAndTesterCapabilities",
    args: [input.positionId, input.specHash, parseEther(input.requestedReward), input.maxExecutors, input.executionMode === "COMPETITION" ? 1 : 0, input.requiredTesterCapabilities],
  });
  onSubmitted?.(hash);
  await confirmed(hash, publicClient, confirmations);
  return hash;
}

async function writeRegistry(functionName: "claimTask" | "closeTeam" | "submitContribution" | "submitWork" | "submitTest" | "review" | "respondToRejection" | "validateMaintenance", args: readonly unknown[]) {
  const { account, wallet, publicClient, contracts, confirmations } = await clients();
  const hash = await wallet.writeContract({ account, address: contracts.taskRegistry, abi: taskRegistryAbi, functionName, args } as never);
  await confirmed(hash, publicClient, confirmations);
  return hash;
}

export const evidenceHash = (value: string) => keccak256(stringToHex(value));
export const claimTaskOnChain = (taskId: bigint) => writeRegistry("claimTask", [taskId]);
export const closeTaskTeamOnChain = (taskId: bigint) => writeRegistry("closeTeam", [taskId]);
export const submitContributionOnChain = (taskId: bigint, artifact: string) => writeRegistry("submitContribution", [taskId, evidenceHash(artifact)]);
export const submitWorkOnChain = (taskId: bigint, artifact: string) => writeRegistry("submitWork", [taskId, evidenceHash(artifact)]);
export const submitTestOnChain = (taskId: bigint, passed: boolean, evidence: string, executorWeightsBps: readonly number[] = [10_000]) => writeRegistry("submitTest", [taskId, passed, evidenceHash(evidence), executorWeightsBps]);
export const reviewTaskOnChain = (taskId: bigint, accepted: boolean, reason: string) => writeRegistry("review", [taskId, accepted, accepted ? `0x${"0".repeat(64)}` : evidenceHash(reason)]);
export const respondToRejectionOnChain = (taskId: bigint, response: string) => writeRegistry("respondToRejection", [taskId, evidenceHash(response)]);
export const validateMaintenanceOnChain = (taskId: bigint, checkpoint: number, passed: boolean, evidence: string) => writeRegistry("validateMaintenance", [taskId, checkpoint, passed, evidenceHash(evidence)]);

export async function claimRewardOnChain(taskId: bigint, checkpoint: number) {
  const { account, wallet, publicClient, contracts, confirmations } = await clients();
  const hash = await wallet.writeContract({ account, address: contracts.rewardVault, abi: rewardVaultAbi, functionName: "claim", args: [taskId, checkpoint] });
  await confirmed(hash, publicClient, confirmations);
  return hash;
}
