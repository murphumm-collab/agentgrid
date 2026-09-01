const BPS = BigInt(10_000);

export const taskRewardAllocationBps = { agentPool: BigInt(9_500), daoTreasury: BigInt(300), sourceVesting: BigInt(200) } as const;
export const lifecycleChargeBps = { evaluation: BigInt(20), publication: BigInt(30), acceptance: BigInt(70), maintenance: BigInt(30) } as const;
export const lifecycleChargeAllocationBps = { rewardVault: BigInt(3_500), burn: BigInt(2_000), daoTreasury: BigInt(2_000), source: BigInt(1_500), securityReserve: BigInt(1_000) } as const;
export const advertisingAllocationBps = { platformCash: BigInt(5_000), rewardVaultBuyback: BigInt(4_000), burnBuyback: BigInt(1_000) } as const;
export const sponsorshipAllocationBps = { sponsoredTaskBuyback: BigInt(7_000), platformCash: BigInt(1_000), burnBuyback: BigInt(1_000), rewardVaultBuyback: BigInt(1_000) } as const;
export const officialSourceVestingSeconds = BigInt(365) * BigInt(24) * BigInt(60) * BigInt(60);
export const minimumSourceVestingSeconds = BigInt(180) * BigInt(24) * BigInt(60) * BigInt(60);

function assertAmount(amount: bigint) {
  if (amount < BigInt(0)) throw new Error("ECONOMIC_AMOUNT_NEGATIVE");
}

function splitWithDust<T extends Record<string, bigint>>(amount: bigint, bps: T, dustRecipient: keyof T): { [K in keyof T]: bigint } {
  assertAmount(amount);
  const result = Object.fromEntries(Object.entries(bps).map(([key, share]) => [key, amount * share / BPS])) as { [K in keyof T]: bigint };
  const allocated = Object.values(result).reduce((sum, value) => sum + value, BigInt(0));
  result[dustRecipient] += amount - allocated;
  return result;
}

export function splitTaskReward(grossReward: bigint) {
  return splitWithDust(grossReward, taskRewardAllocationBps, "agentPool");
}

export type LifecycleChargeStage = keyof typeof lifecycleChargeBps;

export function lifecycleCharge(stakeBasis: bigint, stage: LifecycleChargeStage) {
  assertAmount(stakeBasis);
  const amount = stakeBasis * lifecycleChargeBps[stage] / BPS;
  return { stage, amount, allocation: splitWithDust(amount, lifecycleChargeAllocationBps, "rewardVault") };
}

export function splitAdvertisingRevenue(amount: bigint) {
  return splitWithDust(amount, advertisingAllocationBps, "platformCash");
}

export function splitSponsorshipRevenue(amount: bigint) {
  return splitWithDust(amount, sponsorshipAllocationBps, "sponsoredTaskBuyback");
}

export function agtNetDemand(input: {
  newStake: bigint; executedBuybacks: bigint; burned: bigint; newlyCirculatingRewards: bigint; treasurySales: bigint;
}) {
  for (const amount of Object.values(input)) assertAmount(amount);
  return input.newStake + input.executedBuybacks + input.burned - input.newlyCirculatingRewards - input.treasurySales;
}
