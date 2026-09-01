import { z } from "zod";

export const verificationArbitrationPolicySchema = z.object({
  challengeWindowSeconds: z.literal(86_400),
  arbitrationWindowSeconds: z.literal(259_200),
  minimumStakeTokens: z.literal(500),
  challengeBondTokens: z.literal(50),
  correctChallengeRewardShareBps: z.literal(6_000),
  falseChallengeSlashBps: z.tuple([z.literal(500), z.literal(1_500), z.literal(3_000)]),
  quorum: z.literal(2),
  panelSize: z.literal(3),
}).strict();

export const verificationArbitrationPolicy = verificationArbitrationPolicySchema.parse({
  challengeWindowSeconds: 86_400,
  arbitrationWindowSeconds: 259_200,
  minimumStakeTokens: 500,
  challengeBondTokens: 50,
  correctChallengeRewardShareBps: 6_000,
  falseChallengeSlashBps: [500, 1_500, 3_000],
  quorum: 2,
  panelSize: 3,
});

export function falseChallengeSlashBps(previousFalseChallenges: number) {
  if (!Number.isSafeInteger(previousFalseChallenges) || previousFalseChallenges < 0) throw new Error("ARBITRATION_FAILURE_COUNT_INVALID");
  return verificationArbitrationPolicy.falseChallengeSlashBps[Math.min(previousFalseChallenges, 2)];
}

export function resolveVerificationChallenge(input: {
  upheldVotes: number;
  rejectedVotes: number;
  challengerStake: number;
  validatorStake: number;
  previousFalseChallenges: number;
}) {
  if (input.challengerStake < verificationArbitrationPolicy.minimumStakeTokens) throw new Error("CHALLENGER_STAKE_TOO_LOW");
  const votes = input.upheldVotes + input.rejectedVotes;
  if (votes < verificationArbitrationPolicy.quorum || votes > verificationArbitrationPolicy.panelSize || (input.upheldVotes < verificationArbitrationPolicy.quorum && input.rejectedVotes < verificationArbitrationPolicy.quorum)) throw new Error("ARBITRATION_QUORUM_MISSING");
  const upheld = input.upheldVotes >= verificationArbitrationPolicy.quorum;
  if (upheld) {
    const validatorSlash = Math.min(input.validatorStake, verificationArbitrationPolicy.challengeBondTokens * 2);
    return {
      upheld,
      challengerSlash: 0,
      validatorSlash,
      challengerReward: validatorSlash * verificationArbitrationPolicy.correctChallengeRewardShareBps / 10_000,
      nextFalseChallenges: 0,
    };
  }
  const challengerSlash = input.challengerStake * falseChallengeSlashBps(input.previousFalseChallenges) / 10_000;
  return { upheld, challengerSlash, validatorSlash: 0, challengerReward: 0, nextFalseChallenges: input.previousFalseChallenges + 1 };
}
