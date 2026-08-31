import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { chainContractAddresses, runtimeConfig } from "../src/lib/env";
import { expiredTaskEvaluations } from "../src/lib/store-postgres";
import { requiredSecret } from "../src/lib/secrets";

const expiryAbi = [{
  type: "function", name: "expireTaskEvaluation", stateMutability: "nonpayable",
  inputs: [{ name: "taskId", type: "uint256" }], outputs: [],
}] as const;
const privateKey = requiredSecret("PROTOCOL_OPERATOR_PRIVATE_KEY") as Hex;
const account = privateKeyToAccount(privateKey);
const config = runtimeConfig();
const transport = http(config.BSC_TESTNET_RPC_URL);
const publicClient = createPublicClient({ chain: bscTestnet, transport });
const wallet = createWalletClient({ account, chain: bscTestnet, transport });
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function expireOverdue() {
  const expired = await expiredTaskEvaluations();
  let released = 0;
  for (const evaluation of expired) {
    try {
      const hash = await wallet.writeContract({ address: chainContractAddresses().taskRegistry, abi: expiryAbi, functionName: "expireTaskEvaluation", args: [BigInt(evaluation.taskId)] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
      if (receipt.status !== "success") throw new Error("EXPIRE_TASK_EVALUATION_TRANSACTION_REVERTED");
      released += 1;
      console.log(JSON.stringify({ taskId: evaluation.taskId, deadline: evaluation.deadline, transactionHash: hash, action: "expireTaskEvaluation" }));
    } catch (error) {
      // Another scheduler replica may have released it after this database snapshot.
      console.error(JSON.stringify({ taskId: evaluation.taskId, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { scanned: expired.length, released };
}

async function main() {
  while (!stopping) {
    try { await expireOverdue(); } catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
}

void main();
