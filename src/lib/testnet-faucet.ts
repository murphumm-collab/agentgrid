export function testnetFaucetEligibility(lastClaimAt: bigint, cooldown: bigint, chainTimestamp: bigint) {
  const zero = BigInt(0);
  const nextClaimAt = lastClaimAt === zero ? zero : lastClaimAt + cooldown;
  return {
    eligible: lastClaimAt === zero || chainTimestamp >= nextClaimAt,
    nextClaimAt,
    remainingSeconds: nextClaimAt > chainTimestamp ? nextClaimAt - chainTimestamp : zero,
  } as const;
}
