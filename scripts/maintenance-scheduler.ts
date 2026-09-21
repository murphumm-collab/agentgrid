import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { enqueueAgentJob } from "../src/lib/agent-queue";
import { maintenanceJob } from "../src/lib/maintenance-job";
import { rewardVaultAbi, taskRegistryAbi } from "../src/lib/contracts";
import { chainContractAddresses, runtimeConfig } from "../src/lib/env";
import { protocolSnapshot } from "../src/lib/service";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function schedule() {
  const config = runtimeConfig();
  const client = createPublicClient({ chain: bscTestnet, transport: http(config.BSC_TESTNET_RPC_URL) });
  const snapshot = await protocolSnapshot();
  let queued = 0;
  const addresses = chainContractAddresses();
  const head = await client.getBlockNumber();
  const depth = BigInt(config.CHAIN_CONFIRMATIONS);
  if (head < depth) return;
  const blockNumber = head - depth;
  const block = await client.getBlock({ blockNumber });
  for (const task of snapshot.tasks) {
    if (!/^\d+$/.test(task.id)) continue;
    const [chainTask, grant] = await Promise.all([
      client.readContract({ address: addresses.taskRegistry, abi: taskRegistryAbi, functionName: "tasks", args: [BigInt(task.id)], blockNumber }),
      client.readContract({ address: addresses.rewardVault, abi: rewardVaultAbi, functionName: "getGrant", args: [BigInt(task.id)], blockNumber }),
    ]);
    const job = maintenanceJob({
      chainId: bscTestnet.id, registry: addresses.taskRegistry, taskId: task.id,
      state: chainTask[19], tester: chainTask[2], workRound: chainTask[17], artifactHash: chainTask[7],
      startedAt: grant.startedAt, approved: grant.approved, now: block.timestamp,
    });
    if (job && await enqueueAgentJob(job, true)) queued += 1;
  }
  console.log(JSON.stringify({ time: new Date().toISOString(), queued }));
}

async function main() {
  while (!stopping) {
    try { await schedule(); } catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

void main();
