import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, defineChain, getAddress, http, type Address } from "viem";
import { requirePublisherRequest, requireWalletSession } from "@/lib/auth";
import { taskRegistryAbi } from "@/lib/contracts";
import { chainContractAddresses, isProductionMode, runtimeConfig } from "@/lib/env";
import { apiError } from "@/lib/http";
import { requiredTesterCapabilityMask } from "@/lib/agent-roles";
import { bindTaskCommitmentEvaluationTransaction, createTaskCommitment, pendingTaskCommitmentForPublisher } from "@/lib/store-postgres";
import { taskSpecHash, taskSpecSchema } from "@/lib/task-commitment";
import { readJsonBody } from "@/lib/request-body";

export const dynamic = "force-dynamic";
const recoveryGraceMs = 2 * 60 * 1_000;
const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

async function reconcilePendingTransaction(pending: Awaited<ReturnType<typeof pendingTaskCommitmentForPublisher>>) {
  if (!pending || pending.evaluationTransactionHash) return pending;
  const config = runtimeConfig();
  const chain = defineChain({ id: config.BSC_CHAIN_ID, name: "BSC Testnet", nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 }, rpcUrls: { default: { http: [config.BSC_TESTNET_RPC_URL] } } });
  const client = createPublicClient({ chain, transport: http(config.BSC_TESTNET_RPC_URL) });
  try {
    const latest = await client.getBlockNumber();
    const recentStart = latest > BigInt(5_000) ? latest - BigInt(5_000) : BigInt(0);
    const logs = await client.getContractEvents({
      address: chainContractAddresses().taskRegistry,
      abi: taskRegistryAbi,
      eventName: "TaskEvaluationRequested",
      args: { publisher: getAddress(pending.publisher) as Address },
      fromBlock: BigInt(config.CHAIN_START_BLOCK) > recentStart ? BigInt(config.CHAIN_START_BLOCK) : recentStart,
      toBlock: "latest",
    });
    const transactionHash = logs.filter((log) => log.args.specHash?.toLowerCase() === pending.specHash.toLowerCase()).at(-1)?.transactionHash;
    return transactionHash
      ? await bindTaskCommitmentEvaluationTransaction(pending.id, pending.publisher, transactionHash)
      : pending;
  } catch {
    throw new Error("CHAIN_COMMITMENT_RECONCILIATION_FAILED");
  }
}

export async function GET() {
  try {
    if (!isProductionMode()) throw new Error("CHAIN_COMMITMENTS_REQUIRE_PRODUCTION_MODE");
    const session = await requireWalletSession();
    const pending = await reconcilePendingTransaction(await pendingTaskCommitmentForPublisher(session.address));
    if (!pending) return NextResponse.json({ pending: null }, { headers: privateHeaders });
    const spec = taskSpecSchema.parse(pending.spec);
    const retryAfter = new Date(new Date(pending.createdAt).getTime() + recoveryGraceMs);
    return NextResponse.json({ pending: {
      commitmentId: pending.id,
      positionId: String(spec.stakePositionId),
      specHash: pending.specHash,
      requestedReward: String(spec.requestedReward),
      maxExecutors: spec.maxExecutors,
      executionMode: spec.executionMode,
      requiredTesterCapabilities: requiredTesterCapabilityMask(spec.completionDefinition),
      ...(pending.evaluationTransactionHash ? { transactionHash: pending.evaluationTransactionHash, broadcastReady: false } : {
        broadcastReady: Date.now() >= retryAfter.getTime(),
        retryAfter: retryAfter.toISOString(),
      }),
    } }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isProductionMode()) throw new Error("CHAIN_COMMITMENTS_REQUIRE_PRODUCTION_MODE");
    const body = await readJsonBody<{ publisher: string } & Record<string, unknown>>(request);
    const publisher = await requirePublisherRequest(request, body.publisher);
    const spec = taskSpecSchema.parse(body);
    const specHash = taskSpecHash(spec);
    const commitment = await createTaskCommitment({ id: randomUUID(), publisher, specHash, spec });
    return NextResponse.json({ ...commitment, spec, requestedReward: spec.requestedReward }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
