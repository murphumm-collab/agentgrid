import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { taskRegistryAbi } from "../src/lib/contracts";
import { chainContractAddresses, runtimeConfig } from "../src/lib/env";
import { lifecycleTimeoutAction } from "../src/lib/lifecycle-timeouts";
import { requiredSecret } from "../src/lib/secrets";

const privateKey = requiredSecret("PROTOCOL_OPERATOR_PRIVATE_KEY") as Hex;
const account = privateKeyToAccount(privateKey);
const config = runtimeConfig();
const transport = http(config.BSC_TESTNET_RPC_URL);
const publicClient = createPublicClient({ chain: bscTestnet, transport });
const wallet = createWalletClient({ account, chain: bscTestnet, transport });
const registry = chainContractAddresses().taskRegistry;
const formationWindow = 24n * 60n * 60n;
const inactivityWindow = 6n * 60n * 60n;
let cursor = 1n;
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function scan() {
  const nextTaskId = await publicClient.readContract({ address: registry, abi: taskRegistryAbi, functionName: "nextTaskId" });
  const latest = await publicClient.getBlock();
  if (cursor >= nextTaskId) cursor = 1n;
  let checked = 0;
  let closed = 0;
  let evicted = 0;
  let testersReplaced = 0;
  let publisherReviewsFinalized = 0;
  while (cursor < nextTaskId && checked < 100) {
    const taskId = cursor++;
    checked += 1;
    const task = await publicClient.readContract({ address: registry, abi: taskRegistryAbi, functionName: "tasks", args: [taskId] });
    // Testing=5 and UserReview=7. Both timeout transitions are permissionless;
    // the operator wallet only supplies gas and cannot choose the replacement.
    if (Number(task.state) === 5) {
      const deadline = await publicClient.readContract({ address: registry, abi: taskRegistryAbi, functionName: "testerDeadline", args: [taskId] });
      if (lifecycleTimeoutAction(Number(task.state), Number(deadline), Number(latest.timestamp)) === "REPLACE_TESTER") {
        const hash = await wallet.writeContract({ account, address: registry, abi: taskRegistryAbi, functionName: "replaceInactiveTester", args: [taskId] });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
        if (receipt.status !== "success") throw new Error("TESTER_REPLACEMENT_TRANSACTION_REVERTED");
        testersReplaced += 1;
        console.log(JSON.stringify({ taskId: taskId.toString(), testerReplaced: true, transactionHash: hash }));
      }
      continue;
    }
    if (Number(task.state) === 7) {
      const deadline = await publicClient.readContract({ address: registry, abi: taskRegistryAbi, functionName: "userReviewDeadline", args: [taskId] });
      if (lifecycleTimeoutAction(Number(task.state), Number(deadline), Number(latest.timestamp)) === "FINALIZE_PUBLISHER_REVIEW") {
        const hash = await wallet.writeContract({ account, address: registry, abi: taskRegistryAbi, functionName: "finalizeSilentPublisherReview", args: [taskId] });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
        if (receipt.status !== "success") throw new Error("PUBLISHER_REVIEW_TIMEOUT_TRANSACTION_REVERTED");
        publisherReviewsFinalized += 1;
        console.log(JSON.stringify({ taskId: taskId.toString(), publisherReviewFinalized: true, transactionHash: hash }));
      }
      continue;
    }
    // TaskRegistry.State: Claimed=3, Correction=6 (Evaluating is inserted before Open).
    if (![3, 6].includes(Number(task.state)) || task.executorCount === 0) continue;
    const executors = await publicClient.readContract({ address: registry, abi: taskRegistryAbi, functionName: "getTaskExecutors", args: [taskId] });
    let removed = false;
    for (const executor of executors) {
      const [claimedAt, contributionRound] = await Promise.all([
        publicClient.readContract({ address: registry, abi: taskRegistryAbi, functionName: "executorClaimedAt", args: [taskId, executor] }),
        publicClient.readContract({ address: registry, abi: taskRegistryAbi, functionName: "contributionRound", args: [taskId, executor] }),
      ]);
      if (Number(contributionRound) === Number(task.workRound) || latest.timestamp < claimedAt + inactivityWindow) continue;
      const hash = await wallet.writeContract({ account, address: registry, abi: taskRegistryAbi, functionName: "evictInactiveExecutor", args: [taskId, executor] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
      if (receipt.status !== "success") throw new Error("EXECUTOR_EVICTION_TRANSACTION_REVERTED");
      evicted += 1; removed = true;
      console.log(JSON.stringify({ taskId: taskId.toString(), evictedExecutor: executor, transactionHash: hash }));
      break;
    }
    if (removed || task.teamClosed) continue;
    const formationStartedAt = await publicClient.readContract({ address: registry, abi: taskRegistryAbi, functionName: "teamFormationStartedAt", args: [taskId] });
    if (latest.timestamp < formationStartedAt + formationWindow) continue;
    const hash = await wallet.writeContract({ account, address: registry, abi: taskRegistryAbi, functionName: "closeTeam", args: [taskId] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
    if (receipt.status !== "success") throw new Error("TEAM_CLOSE_TRANSACTION_REVERTED");
    closed += 1;
    console.log(JSON.stringify({ taskId: taskId.toString(), teamClosed: true, executorCount: Number(task.executorCount), transactionHash: hash }));
  }
  return { checked, closed, evicted, testersReplaced, publisherReviewsFinalized };
}

async function main() {
  while (!stopping) {
    try { await scan(); }
    catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

void main();
