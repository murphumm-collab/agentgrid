import { describe, expect, it } from "vitest";
import { reconcileRevenueAccounting, type BuybackExecution } from "./revenue-accounting";

const policy = { settlementAsset: "USDC", settlementDecimals: 18, agtDecimals: 18, maxSlippageBps: 100, periodSeconds: 86_400, maxSettlementSpendPerPeriod: 1_000n };
const receipt = (id: string, channel: "ADVERTISING" | "SPONSORSHIP", amount: bigint, confirmations = 5) => ({
  id, channel, settlementAsset: "USDC", amount, confirmations, requiredConfirmations: 5,
});
const execution = (overrides: Partial<BuybackExecution> = {}): BuybackExecution => ({
  transactionHash: `0x${"1".repeat(64)}`, purpose: "REWARD_VAULT", settlementAsset: "USDC",
  settlementAmount: 100n, agtReceived: 200n, twapPriceE18: 500_000_000_000_000_000n,
  executionPriceE18: 502_000_000_000_000_000n, executedAt: "2026-09-01T00:00:00.000Z",
  confirmations: 5, requiredConfirmations: 5, ...overrides,
});

describe("advertising and sponsorship revenue accounting", () => {
  it("separates confirmed cash, unconfirmed revenue, pending purchases and executed AGT", () => {
    const report = reconcileRevenueAccounting({
      receipts: [receipt("ad-1", "ADVERTISING", 1_000n), receipt("sponsor-1", "SPONSORSHIP", 1_000n), receipt("ad-pending", "ADVERTISING", 500n, 2)],
      executions: [
        execution(),
        execution({ transactionHash: `0x${"2".repeat(64)}`, purpose: "BURN", settlementAmount: 50n, agtReceived: 100n, confirmations: 2 }),
      ],
      policy, now: new Date("2026-09-02T00:00:00.000Z"),
    });
    expect(report).toMatchObject({
      confirmedGrossRevenueSettlement: 2_000n, confirmedPlatformCashSettlement: 600n, pendingRevenueSettlement: 500n,
      buybacks: {
        allocatedSettlement: { REWARD_VAULT: 500n, BURN: 200n, SPONSORED_TASK_POOL: 700n },
        availableToScheduleSettlement: { REWARD_VAULT: 400n, BURN: 150n, SPONSORED_TASK_POOL: 700n },
        submittedPendingSettlement: { REWARD_VAULT: 0n, BURN: 50n, SPONSORED_TASK_POOL: 0n },
        executedSettlement: { REWARD_VAULT: 100n, BURN: 0n, SPONSORED_TASK_POOL: 0n },
        executedAgt: { REWARD_VAULT: 200n, BURN: 0n, SPONSORED_TASK_POOL: 0n },
      },
    });
  });

  it("rejects duplicate receipts and buyback transactions", () => {
    expect(() => reconcileRevenueAccounting({ receipts: [receipt("same", "ADVERTISING", 100n), receipt(" SAME ", "ADVERTISING", 100n)], executions: [], policy })).toThrow("REVENUE_RECEIPT_DUPLICATE");
    expect(() => reconcileRevenueAccounting({ receipts: [receipt("ad", "ADVERTISING", 1_000n)], executions: [execution(), execution()], policy, now: new Date("2026-09-02") })).toThrow("BUYBACK_TRANSACTION_INVALID_OR_DUPLICATE");
    expect(() => reconcileRevenueAccounting({ receipts: [{ ...receipt("bad", "ADVERTISING", 100n), channel: "OTHER" as "ADVERTISING" }], executions: [], policy })).toThrow("REVENUE_CHANNEL_INVALID");
    expect(() => reconcileRevenueAccounting({ receipts: [{ ...receipt("bnb", "ADVERTISING", 100n), settlementAsset: "BNB" }], executions: [], policy })).toThrow("REVENUE_SETTLEMENT_ASSET_MISMATCH");
  });

  it("fails closed on slippage, allocation overspend and per-period caps", () => {
    const receipts = [receipt("ad", "ADVERTISING", 10_000n)];
    expect(() => reconcileRevenueAccounting({ receipts, executions: [execution({ executionPriceE18: 600_000_000_000_000_000n })], policy, now: new Date("2026-09-02") })).toThrow("BUYBACK_SLIPPAGE_EXCEEDED");
    expect(() => reconcileRevenueAccounting({ receipts, executions: [execution({ purpose: "BURN", settlementAmount: 1_001n, agtReceived: 2_002n })], policy: { ...policy, maxSettlementSpendPerPeriod: 2_000n }, now: new Date("2026-09-02") })).toThrow("BUYBACK_ALLOCATION_EXCEEDED");
    expect(() => reconcileRevenueAccounting({ receipts, executions: [execution({ settlementAmount: 1_001n, agtReceived: 2_002n })], policy, now: new Date("2026-09-02") })).toThrow("BUYBACK_PERIOD_CAP_EXCEEDED");
    expect(() => reconcileRevenueAccounting({ receipts, executions: [execution({ agtReceived: 1n })], policy, now: new Date("2026-09-02") })).toThrow("BUYBACK_MINIMUM_AGT_NOT_MET");
  });
});
