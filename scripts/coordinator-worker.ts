import { createPublicClient, createWalletClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { completeAgentJob, heartbeatAgentJob, leaseAgentJob } from "../src/lib/agent-queue";
import { taskRegistryAbi, verificationArbitrationCourtAbi, verificationPanelAbi } from "../src/lib/contracts";
import { chainContractAddresses, chainDeploymentAddresses, runtimeConfig } from "../src/lib/env";
import { requiredSecret } from "../src/lib/secrets";
import { bscRpcTransport } from "../src/lib/bsc-rpc";
import { decideTesterCoordinatorAction } from "../src/lib/tester-coordination";

const privateKey = requiredSecret("PROTOCOL_OPERATOR_PRIVATE_KEY") as Hex;
const account = privateKeyToAccount(privateKey);
const config = runtimeConfig();
const transport = bscRpcTransport(config.BSC_TESTNET_RPC_URL);
const publicClient = createPublicClient({ chain: bscTestnet, transport });
const wallet = createWalletClient({ account, chain: bscTestnet, transport });
const registry = chainContractAddresses().taskRegistry;
const evaluationCoordinatorAbi = [
  { type: "function", name: "finalizeEvaluationPanel", stateMutability: "nonpayable", inputs: [{ name: "taskId", type: "uint256" }], outputs: [] },
  { type: "function", name: "finalizeTaskEvaluation", stateMutability: "nonpayable", inputs: [{ name: "taskId", type: "uint256" }], outputs: [] },
  { type: "function", name: "evaluationSelections", stateMutability: "view", inputs: [{ name: "taskId", type: "uint256" }], outputs: [
    { name: "selectionBlock", type: "uint256" }, { name: "candidateCount", type: "uint256" }, { name: "deadline", type: "uint256" },
    { name: "candidateSetHash", type: "bytes32" }, { name: "selectionProof", type: "bytes32" },
    { name: "reportCount", type: "uint8" }, { name: "approveCount", type: "uint8" }, { name: "panelFinalized", type: "bool" },
  ] },
  { type: "function", name: "tasks", stateMutability: "view", inputs: [{ name: "taskId", type: "uint256" }], outputs: [
    { name: "publisher", type: "address" }, { name: "executor", type: "address" }, { name: "tester", type: "address" },
    { name: "positionId", type: "uint256" }, { name: "requestedReward", type: "uint256" }, { name: "createdAt", type: "uint256" },
    { name: "specHash", type: "bytes32" }, { name: "artifactHash", type: "bytes32" }, { name: "evidenceHash", type: "bytes32" },
    { name: "candidateSetHash", type: "bytes32" }, { name: "selectionProof", type: "bytes32" },
    { name: "testerSelectionBlock", type: "uint256" }, { name: "testerCandidateCount", type: "uint256" }, { name: "teamHash", type: "bytes32" },
    { name: "maxExecutors", type: "uint8" }, { name: "executorCount", type: "uint8" }, { name: "contributionCount", type: "uint8" },
    { name: "workRound", type: "uint32" }, { name: "teamClosed", type: "bool" }, { name: "state", type: "uint8" },
  ] },
] as const;
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function coordinate() {
  const leased = await leaseAgentJob("protocol-coordinator", "COORDINATOR", account.address);
  if (!leased) return false;
  const heartbeat = setInterval(() => { void heartbeatAgentJob(leased.job.id, "protocol-coordinator").catch(() => undefined); }, Math.max(5_000, Math.floor(leased.leaseSeconds * 1_000 / 3)));
  try {
    const taskId = String(leased.job.payload.taskId ?? "");
    if (!/^\d+$/.test(taskId)) throw new Error("COORDINATOR_JOB_TASK_ID_INVALID");
    if (leased.job.kind === "FINALIZE_VERIFICATION_PANEL" || leased.job.kind === "EXPIRE_VERIFICATION_PANEL") {
      const deployment = chainDeploymentAddresses();
      const panel = await publicClient.readContract({ address: deployment.verificationPanel, abi: verificationPanelAbi, functionName: "getPanel", args: [BigInt(taskId)] });
      const expectedStatus = leased.job.kind === "FINALIZE_VERIFICATION_PANEL" ? 3 : [1, 2];
      const phase = leased.job.kind === "FINALIZE_VERIFICATION_PANEL" ? "finalizeVerificationPanel" : "expireVerificationPanel";
      const statusMatches = Array.isArray(expectedStatus) ? expectedStatus.includes(Number(panel.status)) : Number(panel.status) === expectedStatus;
      if (Number(panel.epoch) !== leased.job.payload.panelEpoch || !statusMatches) {
        await completeAgentJob(leased.job.id, "protocol-coordinator", { phase, alreadyFinalized: true });
        return true;
      }
      const dueAt = BigInt(leased.job.payload.dueAt);
      const block = await publicClient.getBlock();
      if (block.timestamp <= dueAt) throw new Error("VERIFICATION_PANEL_LIFECYCLE_NOT_DUE");
      const functionName = leased.job.kind === "FINALIZE_VERIFICATION_PANEL" ? "finalize" : "expire";
      await heartbeatAgentJob(leased.job.id, "protocol-coordinator");
      const hash = await wallet.writeContract({ address: deployment.verificationPanel, abi: verificationPanelAbi, functionName, args: [BigInt(taskId)] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
      if (receipt.status !== "success") throw new Error("VERIFICATION_PANEL_LIFECYCLE_TRANSACTION_REVERTED");
      await completeAgentJob(leased.job.id, "protocol-coordinator", { phase, transactionHash: hash });
      return true;
    }
    if (leased.job.kind === "EXPIRE_VERIFICATION_ARBITRATION") {
      const courtAddress = chainDeploymentAddresses().verificationArbitrationCourt;
      const activeCase = await publicClient.readContract({ address: courtAddress, abi: verificationArbitrationCourtAbi, functionName: "getActiveCase", args: [BigInt(taskId)] });
      if (activeCase.caseId.toLowerCase() !== leased.job.payload.caseId.toLowerCase() || activeCase.resolved) {
        await completeAgentJob(leased.job.id, "protocol-coordinator", { phase: "expireVerificationArbitration", alreadyFinalized: true });
        return true;
      }
      const block = await publicClient.getBlock();
      if (block.timestamp <= BigInt(leased.job.payload.dueAt)) throw new Error("VERIFICATION_ARBITRATION_NOT_DUE");
      await heartbeatAgentJob(leased.job.id, "protocol-coordinator");
      const hash = await wallet.writeContract({ address: courtAddress, abi: verificationArbitrationCourtAbi, functionName: "expireChallenge", args: [BigInt(taskId)] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
      if (receipt.status !== "success") throw new Error("VERIFICATION_ARBITRATION_EXPIRY_TRANSACTION_REVERTED");
      await completeAgentJob(leased.job.id, "protocol-coordinator", { phase: "expireVerificationArbitration", transactionHash: hash });
      return true;
    }
    if (leased.job.kind === "START_MAINTENANCE_PANEL") {
      const task = await publicClient.readContract({ address: registry, abi: evaluationCoordinatorAbi, functionName: "tasks", args: [BigInt(taskId)] });
      if (task[19] !== 8) {
        await completeAgentJob(leased.job.id, "protocol-coordinator", { phase: "requestMaintenancePanel", alreadyFinalized: true });
        return true;
      }
      const checkpoint = Number(leased.job.payload.checkpoint);
      await heartbeatAgentJob(leased.job.id, "protocol-coordinator");
      const hash = await wallet.writeContract({ address: registry, abi: taskRegistryAbi, functionName: "requestMaintenancePanel", args: [BigInt(taskId), checkpoint] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
      if (receipt.status !== "success") throw new Error("START_MAINTENANCE_PANEL_TRANSACTION_REVERTED");
      await completeAgentJob(leased.job.id, "protocol-coordinator", { transactionHash: hash, phase: "requestMaintenancePanel" });
      return true;
    }
    if (leased.job.kind === "FINALIZE_EVALUATION_PANEL" || leased.job.kind === "FINALIZE_TASK_EVALUATION") {
      const functionName = leased.job.kind === "FINALIZE_EVALUATION_PANEL" ? "finalizeEvaluationPanel" : "finalizeTaskEvaluation";
      if (functionName === "finalizeEvaluationPanel") {
        const selection = await publicClient.readContract({ address: registry, abi: evaluationCoordinatorAbi, functionName: "evaluationSelections", args: [BigInt(taskId)] });
        if (selection[7]) {
          await completeAgentJob(leased.job.id, "protocol-coordinator", { phase: functionName, alreadyFinalized: true });
          return true;
        }
        const selectionBlock = BigInt(String(leased.job.payload.selectionBlock ?? "0"));
        const deadline = Number(leased.job.payload.deadline ?? 0);
        while (await publicClient.getBlockNumber() <= selectionBlock) {
          if (stopping || (deadline && Date.now() >= deadline * 1_000)) throw new Error("EVALUATION_PANEL_SELECTION_WINDOW_EXPIRED");
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      } else {
        const task = await publicClient.readContract({ address: registry, abi: evaluationCoordinatorAbi, functionName: "tasks", args: [BigInt(taskId)] });
        if (task[19] !== 1) {
          const panelAddress = chainDeploymentAddresses().verificationPanel;
          const settled = await publicClient.readContract({ address: panelAddress, abi: verificationPanelAbi, functionName: "evaluationOutcomesSettled", args: [BigInt(taskId)] });
          if (!settled && task[19] !== 0) {
            const qualityHash = await wallet.writeContract({ address: panelAddress, abi: verificationPanelAbi, functionName: "settleEvaluationOutcomes", args: [BigInt(taskId)] });
            const qualityReceipt = await publicClient.waitForTransactionReceipt({ hash: qualityHash, confirmations: config.CHAIN_CONFIRMATIONS });
            if (qualityReceipt.status !== "success") throw new Error("SETTLE_EVALUATION_OUTCOMES_TRANSACTION_REVERTED");
          }
          await completeAgentJob(leased.job.id, "protocol-coordinator", { phase: functionName, alreadyFinalized: true });
          return true;
        }
      }
      await heartbeatAgentJob(leased.job.id, "protocol-coordinator");
      const hash = await wallet.writeContract({ address: registry, abi: evaluationCoordinatorAbi, functionName, args: [BigInt(taskId)] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
      if (receipt.status !== "success") throw new Error("FINALIZE_TASK_EVALUATION_TRANSACTION_REVERTED");
      if (functionName === "finalizeTaskEvaluation") {
        const panelAddress = chainDeploymentAddresses().verificationPanel;
        const qualityHash = await wallet.writeContract({ address: panelAddress, abi: verificationPanelAbi, functionName: "settleEvaluationOutcomes", args: [BigInt(taskId)] });
        const qualityReceipt = await publicClient.waitForTransactionReceipt({ hash: qualityHash, confirmations: config.CHAIN_CONFIRMATIONS });
        if (qualityReceipt.status !== "success") throw new Error("SETTLE_EVALUATION_OUTCOMES_TRANSACTION_REVERTED");
      }
      await completeAgentJob(leased.job.id, "protocol-coordinator", { transactionHash: hash, phase: functionName });
      console.log(JSON.stringify({ taskId, transactionHash: hash, phase: functionName }));
      return true;
    }
    const task = await publicClient.readContract({ address: registry, abi: evaluationCoordinatorAbi, functionName: "tasks", args: [BigInt(taskId)] });
    const taskState = Number(task[19]);
    const requestedSelectionBlock = BigInt(task[11]);
    const currentBlock = await publicClient.getBlockNumber();
    const decision = decideTesterCoordinatorAction({
      kind: leased.job.kind as "ASSIGN_TESTER" | "FINALIZE_TESTER",
      taskState,
      selectionBlock: requestedSelectionBlock,
      currentBlock,
    });
    if (decision.action === "complete") {
      await completeAgentJob(leased.job.id, "protocol-coordinator", { phase: decision.phase, alreadyFinalized: true });
      return true;
    }
    if (decision.action === "retry") throw new Error(decision.code);
    // Only an objectively expired blockhash window authorizes a redraw.  A
    // transient RPC/write failure must never silently replace validators.
    const functionName = decision.functionName;
    await heartbeatAgentJob(leased.job.id, "protocol-coordinator");
    const hash = await wallet.writeContract({ address: registry, abi: taskRegistryAbi, functionName, args: [BigInt(taskId)] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
    if (receipt.status !== "success") throw new Error("ASSIGN_TESTER_TRANSACTION_REVERTED");
    await completeAgentJob(leased.job.id, "protocol-coordinator", { transactionHash: hash, phase: functionName });
    console.log(JSON.stringify({ taskId, transactionHash: hash, phase: functionName }));
    return true;
  } finally { clearInterval(heartbeat); }
}

async function main() {
  while (!stopping) {
    try { if (!await coordinate()) await new Promise((resolve) => setTimeout(resolve, 5_000)); }
    catch (error) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

void main();
