import { describe, expect, it } from "vitest";
import {
  advertisingAllocationBps, agtNetDemand, lifecycleCharge, lifecycleChargeBps,
  officialSourceVestingSeconds, splitAdvertisingRevenue, splitSponsorshipRevenue,
  splitTaskReward, sponsorshipAllocationBps, taskRewardAllocationBps,
} from "./protocol-economics";

describe("open protocol economics", () => {
  it("allocates task rewards 95/3/2 and assigns integer dust deterministically to Agents", () => {
    expect(Object.values(taskRewardAllocationBps).reduce((sum, value) => sum + value, 0n)).toBe(10_000n);
    expect(splitTaskReward(10_001n)).toEqual({ agentPool: 9_501n, daoTreasury: 300n, sourceVesting: 200n });
  });

  it("charges only the named lifecycle stage and splits it 35/20/20/15/10", () => {
    expect(Object.values(lifecycleChargeBps).reduce((sum, value) => sum + value, 0n)).toBe(150n);
    expect(lifecycleCharge(1_000_000n, "acceptance")).toEqual({
      stage: "acceptance", amount: 7_000n,
      allocation: { rewardVault: 2_450n, burn: 1_400n, daoTreasury: 1_400n, source: 1_050n, securityReserve: 700n },
    });
  });

  it("keeps advertising and sponsorship cash routes exact and separately auditable", () => {
    expect(Object.values(advertisingAllocationBps).reduce((sum, value) => sum + value, 0n)).toBe(10_000n);
    expect(Object.values(sponsorshipAllocationBps).reduce((sum, value) => sum + value, 0n)).toBe(10_000n);
    expect(splitAdvertisingRevenue(101n)).toEqual({ platformCash: 51n, rewardVaultBuyback: 40n, burnBuyback: 10n });
    expect(splitSponsorshipRevenue(101n)).toEqual({ sponsoredTaskBuyback: 71n, platformCash: 10n, burnBuyback: 10n, rewardVaultBuyback: 10n });
    expect(officialSourceVestingSeconds).toBe(31_536_000n);
  });

  it("reports net demand without converting scenarios into a price claim", () => {
    expect(agtNetDemand({ newStake: 100n, executedBuybacks: 50n, burned: 10n, newlyCirculatingRewards: 80n, treasurySales: 5n })).toBe(75n);
    expect(() => agtNetDemand({ newStake: -1n, executedBuybacks: 0n, burned: 0n, newlyCirculatingRewards: 0n, treasurySales: 0n })).toThrow("ECONOMIC_AMOUNT_NEGATIVE");
  });
});
