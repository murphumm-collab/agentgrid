import { describe, expect, it } from "vitest";
import { competitionScoreBps, competitionWeightsBps } from "./competition-scoring";

describe("competition scoring", () => {
  it("scores only passing candidates using the versioned coverage weights", () => {
    expect(competitionScoreBps({ passed: false, lineCoverage: 1, branchCoverage: 1, functionCoverage: 1, criticalBranchCoverage: 1 })).toBe(0);
    expect(competitionScoreBps({ passed: true, lineCoverage: 0.9, branchCoverage: 0.8, functionCoverage: 0.7, criticalBranchCoverage: 0.6 })).toBe(7450);
  });

  it("normalizes scores to exactly 10000 and assigns rounding dust to the winner", () => {
    const weights = competitionWeightsBps([7_450, 6_100, 0], 0);
    expect(weights).toEqual([5_499, 4_501, 0]);
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(10_000);
    expect(competitionWeightsBps([0, 0], 0)).toEqual([]);
  });
});
