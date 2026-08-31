import { readFile } from "node:fs/promises";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { AgentProtocolClient } from "../src/sdk/client";
import { taskRegistryAbi } from "../src/lib/contracts";

async function readSecret(name: string) {
  const direct = process.env[name];
  const filename = process.env[`${name}_FILE`];
  if (direct && filename) throw new Error(`${name}_SECRET_SOURCE_CONFLICT`);
  if (filename) return (await readFile(filename, "utf8")).replace(/\r?\n$/, "");
  if (direct && process.env.REQUIRE_FILE_SECRETS !== "true") return direct;
  throw new Error(`${name}_FILE_REQUIRED`);
}

async function main() {
  const baseUrl = process.env.AGENTGRID_URL;
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL;
  const archiveFile = process.env.AGENT_ARTIFACT_FILE;
  const agentId = process.env.AGENT_ID;
  if (!baseUrl) throw new Error("AGENTGRID_URL_REQUIRED");
  if (!rpcUrl) throw new Error("BSC_TESTNET_RPC_URL_REQUIRED");
  if (!archiveFile) throw new Error("AGENT_ARTIFACT_FILE_REQUIRED");
  if (!agentId) throw new Error("AGENT_ID_REQUIRED");

  const api = new AgentProtocolClient({
    baseUrl,
    agentId,
    apiKey: await readSecret("AGENT_API_KEY"),
  });
  const runtime = await api.runtimeChainConfig();
  if (runtime.chainId !== 97) throw new Error("BSC_TESTNET_CHAIN_REQUIRED");

  const account = privateKeyToAccount(await readSecret("AGENT_WALLET_PRIVATE_KEY") as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: bscTestnet, transport });
  const walletClient = createWalletClient({ account, chain: bscTestnet, transport });
  const leased = await api.leaseJob("EXECUTOR");
  if (!leased) return;
  if (!["EXECUTE_TASK", "REVISE_TASK", "REPAIR_MAINTENANCE"].includes(leased.job.kind)) {
    throw new Error(`REFERENCE_CONTRIBUTOR_UNSUPPORTED_JOB:${leased.job.kind}`);
  }

  const taskId = String(leased.job.payload.taskId);
  const heartbeat = setInterval(
    () => void api.heartbeatJob(leased.job.id).catch(() => undefined),
    Math.max(5_000, leased.leaseSeconds * 1_000 / 3),
  );

  try {
    const registry = runtime.contracts.taskRegistry;
    const existingExecutors = await publicClient.readContract({
      address: registry,
      abi: taskRegistryAbi,
      functionName: "getTaskExecutors",
      args: [BigInt(taskId)],
    });
    if (leased.job.kind === "EXECUTE_TASK" && !existingExecutors.some((value) => value.toLowerCase() === account.address.toLowerCase())) {
      await api.heartbeatJob(leased.job.id);
      const claimHash = await walletClient.writeContract({
        address: registry,
        abi: taskRegistryAbi,
        functionName: "claimTask",
        args: [BigInt(taskId)],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: claimHash, confirmations: runtime.confirmations });
      if (receipt.status !== "success") throw new Error("CHAIN_TASK_CLAIM_REVERTED");
    }

    let projected: { executionMode?: "COLLABORATION" | "COMPETITION"; maxExecutors?: number; executorIds?: string[] } | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await api.getTask(taskId) as { task: typeof projected };
      projected = response.task;
      if (projected?.executorIds?.some((value) => value.toLowerCase() === account.address.toLowerCase())) break;
      if (attempt === 29) throw new Error("CHAIN_TASK_CLAIM_NOT_INDEXED");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    const archive = await readFile(archiveFile);
    await api.heartbeatJob(leased.job.id);
    const artifact = await api.uploadArtifact(taskId, archive);
    const artifactCommitment = keccak256(stringToHex(artifact.artifactHash));
    const contributionHash = await walletClient.writeContract({
      address: registry,
      abi: taskRegistryAbi,
      functionName: "submitContribution",
      args: [BigInt(taskId), artifactCommitment],
    });
    const contributionReceipt = await publicClient.waitForTransactionReceipt({ hash: contributionHash, confirmations: runtime.confirmations });
    if (contributionReceipt.status !== "success") throw new Error("CHAIN_CONTRIBUTION_SUBMISSION_REVERTED");

    let finalTransactionHash = contributionHash;
    if (projected?.executionMode === "COLLABORATION" && projected.maxExecutors === 1) {
      const workHash = await walletClient.writeContract({
        address: registry,
        abi: taskRegistryAbi,
        functionName: "submitWork",
        args: [BigInt(taskId), artifactCommitment],
      });
      const workReceipt = await publicClient.waitForTransactionReceipt({ hash: workHash, confirmations: runtime.confirmations });
      if (workReceipt.status !== "success") throw new Error("CHAIN_WORK_SUBMISSION_REVERTED");
      finalTransactionHash = workHash;
    }

    await api.completeJob(leased.job.id, {
      artifactHash: artifact.artifactHash,
      contributionTransactionHash: contributionHash,
      finalTransactionHash,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
