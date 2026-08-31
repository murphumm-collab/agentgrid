import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { enqueueAgentJob } from "../src/lib/agent-queue";
import { rewardVaultAbi } from "../src/lib/contracts";
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
  for (const task of snapshot.tasks.filter((item) => item.state === "MAINTENANCE" && item.executorIds[0] && item.testerId)) {
    const grant = await client.readContract({ address: chainContractAddresses().rewardVault, abi: rewardVaultAbi, functionName: "getGrant", args: [BigInt(task.id)] });
    for (const checkpoint of [1, 2, 3] as const) {
      if (task.maintenanceHealthy[checkpoint - 1] || grant.approved[checkpoint]) continue;
      const dueAt = await client.readContract({ address: chainContractAddresses().rewardVault, abi: rewardVaultAbi, functionName: "dueAt", args: [grant.startedAt, checkpoint] });
      if (dueAt > BigInt(Math.floor(Date.now() / 1_000))) continue;
      if (await enqueueAgentJob({
        id: `maintenance:${task.id}:${checkpoint}:${Math.floor(Date.now() / 3_600_000)}`, role: "TESTER", kind: "MAINTENANCE_VALIDATION",
        payload: { taskId: task.id, checkpoint, tester: task.testerId, dueAt: dueAt.toString() }, createdAt: new Date().toISOString(),
      })) queued += 1;
    }
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
