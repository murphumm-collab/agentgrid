import { createPublicClient, createWalletClient, keccak256, parseEther, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { AgentProtocolClient } from "../src/sdk/client";
import { chainContractAddresses, runtimeConfig } from "../src/lib/env";
import { deterministicTaskEvaluation, taskEvaluationMessage } from "../src/lib/task-evaluation";
import { requiredConfigValue, requiredSecret } from "../src/lib/secrets";
import { bscRpcTransport } from "../src/lib/bsc-rpc";

const evaluationAbi = [{
  type: "function", name: "submitEvaluation", stateMutability: "nonpayable",
  inputs: [
    { name: "taskId", type: "uint256" }, { name: "categoryHash", type: "bytes32" },
    { name: "difficultyBps", type: "uint16" }, { name: "estimatedHours", type: "uint32" },
    { name: "testabilityBps", type: "uint16" }, { name: "recommendedReward", type: "uint256" },
    { name: "approve", type: "bool" }, { name: "reportHash", type: "bytes32" },
  ], outputs: [],
}, {
  type: "function", name: "evaluationReports", stateMutability: "view",
  inputs: [{ name: "taskId", type: "uint256" }, { name: "evaluator", type: "address" }],
  outputs: [
    { name: "categoryHash", type: "bytes32" }, { name: "difficultyBps", type: "uint16" },
    { name: "estimatedHours", type: "uint32" }, { name: "testabilityBps", type: "uint16" },
    { name: "recommendedReward", type: "uint256" }, { name: "approve", type: "bool" },
    { name: "reportHash", type: "bytes32" }, { name: "submitted", type: "bool" },
  ],
}] as const;

function required(name: string) { return ["AGENT_API_KEY", "AGENT_WALLET_PRIVATE_KEY"].includes(name) ? requiredSecret(name) : requiredConfigValue(name); }
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function evaluateOne(protocol: AgentProtocolClient, account: ReturnType<typeof privateKeyToAccount>) {
  const leased = await protocol.leaseJob("EVALUATOR");
  if (!leased) return false;
  if (leased.job.kind !== "EVALUATE_TASK") throw new Error(`UNSUPPORTED_EVALUATOR_JOB_${leased.job.kind}`);
  const heartbeat = setInterval(() => { void protocol.heartbeatJob(leased.job.id).catch(() => undefined); }, Math.max(5_000, Math.floor(leased.leaseSeconds * 1_000 / 3)));
  try {
    const taskId = String(leased.job.payload.taskId ?? "");
    if (!/^\d+$/.test(taskId)) throw new Error("EVALUATION_JOB_TASK_ID_INVALID");
    const { evaluation } = await protocol.getTaskEvaluation(taskId);
    const report = deterministicTaskEvaluation(evaluation.spec);
    const config = runtimeConfig();
    const taskRegistry = chainContractAddresses().taskRegistry;
    const signingDomain = { chainId: config.BSC_CHAIN_ID, taskRegistry, taskId, report };
    const commitment = taskEvaluationMessage(signingDomain);
    const signature = await account.signMessage({ message: commitment.message });
    await protocol.heartbeatJob(leased.job.id);
    const stored = await protocol.submitSignedTaskEvaluation(taskId, { chainId: config.BSC_CHAIN_ID, taskRegistry, report, signature });
    if (stored.reportHash.toLowerCase() !== commitment.reportHash.toLowerCase()) throw new Error("EVALUATION_REPORT_HASH_MISMATCH");
    const transport = bscRpcTransport(config.BSC_TESTNET_RPC_URL);
    const wallet = createWalletClient({ account, chain: bscTestnet, transport });
    const publicClient = createPublicClient({ chain: bscTestnet, transport });
    const existing = await publicClient.readContract({ address: taskRegistry, abi: evaluationAbi, functionName: "evaluationReports", args: [BigInt(taskId), account.address] });
    if (existing[7]) {
      if (existing[6].toLowerCase() !== commitment.reportHash.toLowerCase()) throw new Error("ONCHAIN_TASK_EVALUATION_EQUIVOCATION");
      await protocol.completeJob(leased.job.id, { reportHash: commitment.reportHash, alreadySubmitted: true, approve: report.approve });
      return true;
    }
    await protocol.heartbeatJob(leased.job.id);
    const hash = await wallet.writeContract({
      address: taskRegistry, abi: evaluationAbi, functionName: "submitEvaluation",
      args: [BigInt(taskId), keccak256(stringToHex(report.category)), report.difficultyBps, report.estimatedHours,
        report.testabilityBps, parseEther(String(report.recommendedReward)), report.approve, commitment.reportHash],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
    if (receipt.status !== "success") throw new Error("TASK_EVALUATION_TRANSACTION_REVERTED");
    await protocol.completeJob(leased.job.id, { reportHash: commitment.reportHash, transactionHash: hash, approve: report.approve });
    console.log(JSON.stringify({ taskId, evaluator: account.address, approve: report.approve, reportHash: commitment.reportHash, transactionHash: hash }));
    return true;
  } finally { clearInterval(heartbeat); }
}

async function main() {
  const account = privateKeyToAccount(required("AGENT_WALLET_PRIVATE_KEY") as Hex);
  const protocol = new AgentProtocolClient({ baseUrl: required("PROTOCOL_URL"), agentId: required("AGENT_ID"), apiKey: required("AGENT_API_KEY") });
  while (!stopping) {
    try { if (!await evaluateOne(protocol, account)) await sleep(5_000); }
    catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); await sleep(5_000); }
  }
}

void main();
