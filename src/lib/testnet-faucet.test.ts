import { describe, expect, it } from "vitest";
import { testnetFaucetEligibility } from "./testnet-faucet";

describe("BSC Testnet faucet eligibility", () => {
  it("allows the first claim", () => {
    expect(testnetFaucetEligibility(0n, 86_400n, 100n)).toEqual({ eligible: true, nextClaimAt: 0n, remainingSeconds: 0n });
  });

  it("fails closed during cooldown and exposes the exact remaining time", () => {
    expect(testnetFaucetEligibility(100n, 86_400n, 200n)).toEqual({ eligible: false, nextClaimAt: 86_500n, remainingSeconds: 86_300n });
  });

  it("allows a new claim at the exact cooldown boundary", () => {
    expect(testnetFaucetEligibility(100n, 86_400n, 86_500n)).toEqual({ eligible: true, nextClaimAt: 86_500n, remainingSeconds: 0n });
  });
});
