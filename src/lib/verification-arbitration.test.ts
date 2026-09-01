import { describe, expect, it } from "vitest";
import { falseChallengeSlashBps, resolveVerificationChallenge } from "./verification-arbitration";

describe("verification arbitration", () => {
  it("rewards a staked challenger when two arbitrators uphold the report challenge", () => {
    expect(resolveVerificationChallenge({ upheldVotes: 2, rejectedVotes: 1, challengerStake: 500, validatorStake: 800, previousFalseChallenges: 2 })).toEqual({
      upheld: true, challengerSlash: 0, validatorSlash: 100, challengerReward: 60, nextFalseChallenges: 0,
    });
  });

  it("escalates repeated false challenge slashing and caps the rate", () => {
    expect([0, 1, 2, 8].map(falseChallengeSlashBps)).toEqual([500, 1_500, 3_000, 3_000]);
    expect(resolveVerificationChallenge({ upheldVotes: 1, rejectedVotes: 2, challengerStake: 1_000, validatorStake: 500, previousFalseChallenges: 1 })).toMatchObject({
      upheld: false, challengerSlash: 150, nextFalseChallenges: 2,
    });
  });

  it("rejects an unqualified challenger and incomplete court", () => {
    expect(() => resolveVerificationChallenge({ upheldVotes: 2, rejectedVotes: 1, challengerStake: 499, validatorStake: 500, previousFalseChallenges: 0 })).toThrow("CHALLENGER_STAKE_TOO_LOW");
    expect(() => resolveVerificationChallenge({ upheldVotes: 1, rejectedVotes: 1, challengerStake: 500, validatorStake: 500, previousFalseChallenges: 0 })).toThrow("ARBITRATION_QUORUM_MISSING");
  });
});
