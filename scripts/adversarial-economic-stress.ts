/** Analytical stress model, anchored by the full-chain coalition regression.
 * All roles except reserve share one controller. Stake is returned; gas and
 * cost of capital are excluded and reported, rather than counted as burned.
 * This is a vulnerability detector, not independent-control verification.
 */
export function simulateCoalition(size: number, rotatePublisher: boolean) {
  let remaining = 100_000;
  let gross = 0;
  let fees = 0;
  let accepted = 0;
  const rewards: number[] = [];
  for (let index = 0; index < size && remaining > 0; index++) {
    const requested = 1000;
    const stake = 1000;
    const publicationFee = Math.min(stake * 0.1, Math.max(10, requested * 0.02));
    const multiplier = [1, 0.7, 0.4, 0.2, 0.1][rotatePublisher ? 0 : Math.min(index, 4)];
    const reward = Math.min(remaining, Math.min(requested, stake * 0.2) * multiplier);
    remaining -= reward;
    gross += reward;
    fees += publicationFee; // 3 AGT evaluation fee is recovered by coalition.
    accepted++;
    if (index < 5) rewards.push(reward);
  }
  return { accepted, gross, participantPayout: gross * 0.8, netProtocolProfit: gross * 0.8 - fees, publicationFees: fees, remainingBudget: remaining, firstRewards: rewards };
}
if (process.argv[1]?.endsWith("adversarial-economic-stress.ts")) {
  console.log(JSON.stringify({
    scope: "analytical-model-not-10000-onchain-transactions", excludes: ["gas", "capital-cost", "market-price"],
    scales: [100, 1000, 10000].map((size) => ({ size, ...simulateCoalition(size, true) })),
    repeated: simulateCoalition(5, false), rotated: simulateCoalition(5, true),
    securityAcceptance: "FAIL_POSITIVE_COALITION_PROFIT",
  }, null, 2));
  process.exitCode = 2;
}
