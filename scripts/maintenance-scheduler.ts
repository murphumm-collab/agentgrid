import { createPublicClient } from "viem";
import { bscTestnet } from "viem/chains";
import { enqueueAgentJob } from "../src/lib/agent-queue";
import { rewardVaultAbi, verificationArbitrationCourtAbi, verificationPanelAbi } from "../src/lib/contracts";
import { chainContractAddresses, chainDeploymentAddresses, runtimeConfig } from "../src/lib/env";
import { protocolSnapshot } from "../src/lib/service";
import { bscRpcTransport } from "../src/lib/bsc-rpc";
import { dueVerificationLifecycleAction } from "../src/lib/verification-lifecycle";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function schedule() {
  const config = runtimeConfig();
  const client = createPublicClient({ chain: bscTestnet, transport: bscRpcTransport(config.BSC_TESTNET_RPC_URL) });
  const snapshot = await protocolSnapshot();
  const deployment = chainDeploymentAddresses();
  const now = BigInt(Math.floor(Date.now() / 1_000));
  let queued = 0;
  for (const task of snapshot.tasks.filter((item) => item.state === "MAINTENANCE" && item.executorIds[0] && item.testerIds?.length === 3)) {
    const grant = await client.readContract({ address: chainContractAddresses().rewardVault, abi: rewardVaultAbi, functionName: "getGrant", args: [BigInt(task.id)] });
    for (const checkpoint of [1, 2, 3] as const) {
      if (task.maintenanceHealthy[checkpoint - 1] || grant.approved[checkpoint]) continue;
      const dueAt = await client.readContract({ address: chainContractAddresses().rewardVault, abi: rewardVaultAbi, functionName: "dueAt", args: [grant.startedAt, checkpoint] });
      if (dueAt > BigInt(Math.floor(Date.now() / 1_000))) continue;
      if (await enqueueAgentJob({
        id: `maintenance-panel:${task.id}:${checkpoint}`, role: "COORDINATOR", kind: "START_MAINTENANCE_PANEL",
        payload: { taskId: task.id, checkpoint, dueAt: dueAt.toString() }, createdAt: new Date().toISOString(),
      })) queued += 1;
    }
  }
  for (const task of snapshot.tasks.filter((item) => item.state === "TESTING")) {
    const panel = await client.readContract({ address: deployment.verificationPanel, abi: verificationPanelAbi, functionName: "getPanel", args: [BigInt(task.id)] });
    const status = Number(panel.status);
    const panelEpoch = Number(panel.epoch);
    const activeCase = status === 4
      ? await client.readContract({ address: deployment.verificationArbitrationCourt, abi: verificationArbitrationCourtAbi, functionName: "getActiveCase", args: [BigInt(task.id)] })
      : undefined;
    const action = dueVerificationLifecycleAction({
      now,
      panel: { status, epoch: panelEpoch, commitDeadline: panel.commitDeadline, revealDeadline: panel.revealDeadline, challengeDeadline: panel.challengeDeadline },
      activeCase,
    });
    if (action?.kind === "EXPIRE_VERIFICATION_PANEL") {
      if (await enqueueAgentJob({
        id: `verification-panel:expire:${task.id}:${action.panelEpoch}`, role: "COORDINATOR", kind: action.kind,
        payload: { taskId: task.id, panelEpoch: action.panelEpoch, dueAt: action.dueAt.toString() }, createdAt: new Date().toISOString(),
      })) queued += 1;
    } else if (action?.kind === "FINALIZE_VERIFICATION_PANEL") {
      if (await enqueueAgentJob({
        id: `verification-panel:finalize:${task.id}:${action.panelEpoch}`, role: "COORDINATOR", kind: action.kind,
        payload: { taskId: task.id, panelEpoch: action.panelEpoch, dueAt: action.dueAt.toString() }, createdAt: new Date().toISOString(),
      })) queued += 1;
    } else if (action?.kind === "EXPIRE_VERIFICATION_ARBITRATION") {
      if (await enqueueAgentJob({
        id: `verification-arbitration:expire:${task.id}:${action.caseId}`, role: "COORDINATOR", kind: action.kind,
        payload: { taskId: task.id, caseId: action.caseId, dueAt: action.dueAt.toString() }, createdAt: new Date().toISOString(),
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
