import { splitAdvertisingRevenue, splitSponsorshipRevenue } from "./protocol-economics";

export type RevenueChannel = "ADVERTISING" | "SPONSORSHIP";
export type BuybackPurpose = "REWARD_VAULT" | "BURN" | "SPONSORED_TASK_POOL";

export interface RevenueReceipt {
  id: string;
  channel: RevenueChannel;
  settlementAsset: string;
  amount: bigint;
  confirmations: number;
  requiredConfirmations: number;
}

export interface BuybackExecution {
  transactionHash: string;
  purpose: BuybackPurpose;
  settlementAsset: string;
  settlementAmount: bigint;
  agtReceived: bigint;
  twapPriceE18: bigint;
  executionPriceE18: bigint;
  executedAt: string;
  confirmations: number;
  requiredConfirmations: number;
}

export interface BuybackExecutionPolicy {
  settlementAsset: string;
  settlementDecimals: number;
  agtDecimals: number;
  maxSlippageBps: number;
  periodSeconds: number;
  maxSettlementSpendPerPeriod: bigint;
}

const purposes: readonly BuybackPurpose[] = ["REWARD_VAULT", "BURN", "SPONSORED_TASK_POOL"];
const emptyPurposeAmounts = () => Object.fromEntries(purposes.map((purpose) => [purpose, BigInt(0)])) as Record<BuybackPurpose, bigint>;

function assertConfirmations(confirmations: number, required: number) {
  if (!Number.isInteger(confirmations) || confirmations < 0 || !Number.isInteger(required) || required <= 0) {
    throw new Error("REVENUE_CONFIRMATIONS_INVALID");
  }
}

function isConfirmed(confirmations: number, required: number) {
  assertConfirmations(confirmations, required);
  return confirmations >= required;
}

export function reconcileRevenueAccounting(input: {
  receipts: RevenueReceipt[];
  executions: BuybackExecution[];
  policy: BuybackExecutionPolicy;
  now?: Date;
}) {
  const { policy } = input;
  if (!policy.settlementAsset.trim() || !Number.isInteger(policy.maxSlippageBps) || policy.maxSlippageBps < 0 || policy.maxSlippageBps > 1_000
    || !Number.isInteger(policy.settlementDecimals) || policy.settlementDecimals < 0 || policy.settlementDecimals > 36
    || !Number.isInteger(policy.agtDecimals) || policy.agtDecimals < 0 || policy.agtDecimals > 36
    || !Number.isInteger(policy.periodSeconds) || policy.periodSeconds <= 0 || policy.maxSettlementSpendPerPeriod <= BigInt(0)) {
    throw new Error("BUYBACK_POLICY_INVALID");
  }
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("BUYBACK_NOW_INVALID");

  const receiptIds = new Set<string>();
  const allocations = emptyPurposeAmounts();
  let pendingRevenueStable = BigInt(0);
  let confirmedGrossRevenueStable = BigInt(0);
  let confirmedPlatformCashStable = BigInt(0);
  for (const receipt of input.receipts) {
    const receiptId = receipt.id.trim().toLowerCase();
    if (!receiptId || receiptIds.has(receiptId)) throw new Error("REVENUE_RECEIPT_DUPLICATE");
    receiptIds.add(receiptId);
    if (receipt.settlementAsset !== policy.settlementAsset) throw new Error("REVENUE_SETTLEMENT_ASSET_MISMATCH");
    if (receipt.channel !== "ADVERTISING" && receipt.channel !== "SPONSORSHIP") throw new Error("REVENUE_CHANNEL_INVALID");
    if (receipt.amount <= BigInt(0)) throw new Error("REVENUE_AMOUNT_INVALID");
    if (!isConfirmed(receipt.confirmations, receipt.requiredConfirmations)) {
      pendingRevenueStable += receipt.amount;
      continue;
    }
    confirmedGrossRevenueStable += receipt.amount;
    if (receipt.channel === "ADVERTISING") {
      const split = splitAdvertisingRevenue(receipt.amount);
      confirmedPlatformCashStable += split.platformCash;
      allocations.REWARD_VAULT += split.rewardVaultBuyback;
      allocations.BURN += split.burnBuyback;
    } else {
      const split = splitSponsorshipRevenue(receipt.amount);
      confirmedPlatformCashStable += split.platformCash;
      allocations.SPONSORED_TASK_POOL += split.sponsoredTaskBuyback;
      allocations.REWARD_VAULT += split.rewardVaultBuyback;
      allocations.BURN += split.burnBuyback;
    }
  }

  const transactionHashes = new Set<string>();
  const scheduled = emptyPurposeAmounts();
  const pendingExecutions = emptyPurposeAmounts();
  const executedStable = emptyPurposeAmounts();
  const executedAgt = emptyPurposeAmounts();
  const periodSpend = new Map<number, bigint>();
  for (const execution of input.executions) {
    const transactionHash = execution.transactionHash.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(transactionHash) || transactionHashes.has(transactionHash)) throw new Error("BUYBACK_TRANSACTION_INVALID_OR_DUPLICATE");
    transactionHashes.add(transactionHash);
    if (execution.settlementAsset !== policy.settlementAsset) throw new Error("BUYBACK_SETTLEMENT_ASSET_MISMATCH");
    if (!purposes.includes(execution.purpose)) throw new Error("BUYBACK_PURPOSE_INVALID");
    if (execution.settlementAmount <= BigInt(0) || execution.agtReceived <= BigInt(0)
      || execution.twapPriceE18 <= BigInt(0) || execution.executionPriceE18 <= BigInt(0)) throw new Error("BUYBACK_AMOUNT_INVALID");
    assertConfirmations(execution.confirmations, execution.requiredConfirmations);
    const executedAt = new Date(execution.executedAt).getTime();
    if (!Number.isFinite(executedAt) || executedAt > nowMs) throw new Error("BUYBACK_EXECUTION_TIME_INVALID");
    const deviation = execution.executionPriceE18 > execution.twapPriceE18
      ? execution.executionPriceE18 - execution.twapPriceE18
      : execution.twapPriceE18 - execution.executionPriceE18;
    if ((deviation * BigInt(10_000)) / execution.twapPriceE18 > BigInt(policy.maxSlippageBps)) throw new Error("BUYBACK_SLIPPAGE_EXCEEDED");
    const settlementScale = BigInt(10) ** BigInt(policy.settlementDecimals);
    const agtScale = BigInt(10) ** BigInt(policy.agtDecimals);
    const twapAgtOut = (execution.settlementAmount * agtScale * (BigInt(10) ** BigInt(18)))
      / (settlementScale * execution.twapPriceE18);
    const minimumAgtOut = (twapAgtOut * BigInt(10_000 - policy.maxSlippageBps)) / BigInt(10_000);
    if (twapAgtOut <= BigInt(0) || execution.agtReceived < minimumAgtOut) throw new Error("BUYBACK_MINIMUM_AGT_NOT_MET");
    scheduled[execution.purpose] += execution.settlementAmount;
    if (scheduled[execution.purpose] > allocations[execution.purpose]) throw new Error("BUYBACK_ALLOCATION_EXCEEDED");
    const period = Math.floor(executedAt / (policy.periodSeconds * 1_000));
    const nextPeriodSpend = (periodSpend.get(period) ?? BigInt(0)) + execution.settlementAmount;
    if (nextPeriodSpend > policy.maxSettlementSpendPerPeriod) throw new Error("BUYBACK_PERIOD_CAP_EXCEEDED");
    periodSpend.set(period, nextPeriodSpend);
    if (isConfirmed(execution.confirmations, execution.requiredConfirmations)) {
      executedStable[execution.purpose] += execution.settlementAmount;
      executedAgt[execution.purpose] += execution.agtReceived;
    } else {
      pendingExecutions[execution.purpose] += execution.settlementAmount;
    }
  }

  const availableToSchedule = emptyPurposeAmounts();
  for (const purpose of purposes) availableToSchedule[purpose] = allocations[purpose] - scheduled[purpose];
  return {
    settlementAsset: policy.settlementAsset,
    confirmedGrossRevenueSettlement: confirmedGrossRevenueStable,
    confirmedPlatformCashSettlement: confirmedPlatformCashStable,
    pendingRevenueSettlement: pendingRevenueStable,
    buybacks: {
      allocatedSettlement: allocations,
      availableToScheduleSettlement: availableToSchedule,
      submittedPendingSettlement: pendingExecutions,
      executedSettlement: executedStable,
      executedAgt,
    },
    controls: {
      maxSlippageBps: policy.maxSlippageBps,
      settlementDecimals: policy.settlementDecimals,
      agtDecimals: policy.agtDecimals,
      periodSeconds: policy.periodSeconds,
      maxSettlementSpendPerPeriod: policy.maxSettlementSpendPerPeriod,
      activation: "SIMULATION_ONLY_EXTERNAL_DEX_ORACLE_AUDIT_REQUIRED" as const,
    },
  };
}
