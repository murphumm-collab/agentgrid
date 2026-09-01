"use client";

import { createPublicClient, createWalletClient, custom, decodeEventLog, keccak256, parseEther, stringToHex, type EIP1193Provider, type Hash, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { agentRegistryAbi, rewardVaultAbi, stakeManagerAbi, taskRegistryAbi, tokenAbi, verificationArbitrationCourtAbi } from "./contracts";
import { loadBrowserChainConfig } from "./browser-chain-config";
import { browserWalletProvider } from "./browser-wallet";
import { agentRegistrationRequiresTransaction, assertWalletSessionAccount } from "./agent-management";

declare global { interface Window { ethereum?: EIP1193Provider } }

export async function registerAgentPosition(positionId: bigint, capabilities: number = 7, sessionOwner?: string) {
  const { account, wallet, publicClient, contracts, confirmations } = await clients(sessionOwner);
  const blockNumber = await publicClient.getBlockNumber();
  const [registeredPosition, registeredCapabilities, active] = await Promise.all([
    publicClient.readContract({ address: contracts.agentRegistry, abi: agentRegistryAbi, functionName: "agentPosition", args: [account], blockNumber }),
    publicClient.readContract({ address: contracts.agentRegistry, abi: agentRegistryAbi, functionName: "agentCapabilities", args: [account], blockNumber }),
    publicClient.readContract({ address: contracts.agentRegistry, abi: agentRegistryAbi, functionName: "agentActive", args: [account], blockNumber }),
  ]);
  if (!agentRegistrationRequiresTransaction(
    { positionId: registeredPosition, capabilities: registeredCapabilities, active },
    { positionId, capabilities },
  )) return { account, hash: null, alreadyRegistered: true as const };
  const hash = await wallet.writeContract({ account, address: contracts.agentRegistry, abi: agentRegistryAbi, functionName: "registerWithCapabilities", args: [positionId, capabilities] });
  await confirmed(hash, publicClient, confirmations);
  return { account, hash, alreadyRegistered: false as const };
}

export async function setAgentActive(active: boolean, sessionOwner?: string) {
  const { account, wallet, publicClient, contracts, confirmations } = await clients(sessionOwner);
  const hash = await wallet.writeContract({ account, address: contracts.agentRegistry, abi: agentRegistryAbi, functionName: "setActive", args: [active] });
  await confirmed(hash, publicClient, confirmations);
  return { account, hash, active };
}

export async function openRoleRehabilitationAppeal(role: 1 | 2 | 4, evidence: string, sessionOwner?: string) {
  const normalizedEvidence = evidence.trim();
  if (normalizedEvidence.length < 20) throw new Error("REHABILITATION_EVIDENCE_TOO_SHORT");
  const { account, wallet, publicClient, contracts, confirmations } = await clients(sessionOwner);
  const minimumStake = parseEther("500");
  const [courtStake, courtLocked] = await Promise.all([
    publicClient.readContract({ address: contracts.verificationArbitrationCourt, abi: verificationArbitrationCourtAbi, functionName: "stake", args: [account] }),
    publicClient.readContract({ address: contracts.verificationArbitrationCourt, abi: verificationArbitrationCourtAbi, functionName: "lockedStake", args: [account] }),
  ]);
  const available = courtStake - courtLocked;
  if (available < minimumStake) {
    const topUp = minimumStake - available;
    const allowance = await publicClient.readContract({ address: contracts.token, abi: tokenAbi, functionName: "allowance", args: [account, contracts.verificationArbitrationCourt] });
    if (allowance < topUp) {
      await confirmed(await wallet.writeContract({ account, address: contracts.token, abi: tokenAbi, functionName: "approve", args: [contracts.verificationArbitrationCourt, topUp] }), publicClient, confirmations);
    }
    await confirmed(await wallet.writeContract({ account, address: contracts.verificationArbitrationCourt, abi: verificationArbitrationCourtAbi, functionName: "deposit", args: [topUp] }), publicClient, confirmations);
  }
  const hash = await wallet.writeContract({
    account,
    address: contracts.verificationArbitrationCourt,
    abi: verificationArbitrationCourtAbi,
    functionName: "openRehabilitationAppeal",
    args: [role, evidenceHash(normalizedEvidence)],
  });
  await confirmed(hash, publicClient, confirmations);
  return { account, hash, role, evidenceHash: evidenceHash(normalizedEvidence) };
}

async function clients(expectedAccount?: string) {
  const { contracts, confirmations } = await loadBrowserChainConfig();
  const provider = browserWalletProvider();
  const wallet = createWalletClient({ chain: bscTestnet, transport: custom(provider) });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error("WALLET_NOT_CONNECTED");
  assertWalletSessionAccount(account, expectedAccount);
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
  onSubmitted?: (hash: Hash) => void | Promise<void>,
) {
  const { account, wallet, publicClient, contracts, confirmations } = await clients();
  const hash = await wallet.writeContract({
    account, address: contracts.taskRegistry, abi: taskRegistryAbi, functionName: "createTaskWithModeAndTesterCapabilities",
    args: [input.positionId, input.specHash, parseEther(input.requestedReward), input.maxExecutors, input.executionMode === "COMPETITION" ? 1 : 0, input.requiredTesterCapabilities],
  });
  await onSubmitted?.(hash);
  await confirmed(hash, publicClient, confirmations);
  return hash;
}

async function writeRegistry(functionName: "claimTask" | "closeTeam" | "submitContribution" | "submitWork" | "review" | "respondToRejection", args: readonly unknown[]) {
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
export const reviewTaskOnChain = (taskId: bigint, accepted: boolean, reason: string) => writeRegistry("review", [taskId, accepted, accepted ? `0x${"0".repeat(64)}` : evidenceHash(reason)]);
export const respondToRejectionOnChain = (taskId: bigint, response: string) => writeRegistry("respondToRejection", [taskId, evidenceHash(response)]);

export async function claimRewardOnChain(taskId: bigint, checkpoint: number) {
  const { account, wallet, publicClient, contracts, confirmations } = await clients();
  const hash = await wallet.writeContract({ account, address: contracts.rewardVault, abi: rewardVaultAbi, functionName: "claim", args: [taskId, checkpoint] });
  await confirmed(hash, publicClient, confirmations);
  return hash;
}
