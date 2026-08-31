import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, defineChain, http } from "viem";
import { z } from "zod";
import { requirePublisherRequest } from "@/lib/auth";
import { isProductionMode, runtimeConfig } from "@/lib/env";
import { apiError } from "@/lib/http";
import { readJsonBody } from "@/lib/request-body";
import { bindTaskCommitmentEvaluationTransaction, clearRevertedTaskCommitmentEvaluationTransaction } from "@/lib/store-postgres";

const schema = z.object({
  publisher: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
}).strict();
const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isProductionMode()) throw new Error("CHAIN_COMMITMENTS_REQUIRE_PRODUCTION_MODE");
    const { id } = await context.params;
    const input = schema.parse(await readJsonBody(request));
    const publisher = await requirePublisherRequest(request, input.publisher);
    const commitment = await bindTaskCommitmentEvaluationTransaction(id, publisher, input.transactionHash);
    return NextResponse.json({ commitmentId: commitment.id, transactionHash: commitment.evaluationTransactionHash }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isProductionMode()) throw new Error("CHAIN_COMMITMENTS_REQUIRE_PRODUCTION_MODE");
    const { id } = await context.params;
    const input = schema.parse(await readJsonBody(request));
    const publisher = await requirePublisherRequest(request, input.publisher);
    const config = runtimeConfig();
    const chain = defineChain({ id: config.BSC_CHAIN_ID, name: "BSC Testnet", nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 }, rpcUrls: { default: { http: [config.BSC_TESTNET_RPC_URL] } } });
    const client = createPublicClient({ chain, transport: http(config.BSC_TESTNET_RPC_URL) });
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: input.transactionHash as `0x${string}` }); }
    catch { throw new Error("TRANSACTION_RECEIPT_NOT_FOUND"); }
    if (receipt.status !== "reverted") throw new Error("TASK_COMMITMENT_TRANSACTION_NOT_REVERTED");
    const cleared = await clearRevertedTaskCommitmentEvaluationTransaction(id, publisher, input.transactionHash);
    return NextResponse.json(cleared, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
