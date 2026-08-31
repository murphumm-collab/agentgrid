export interface CompetitionScoreInput {
  passed: boolean;
  lineCoverage: number;
  branchCoverage: number;
  functionCoverage: number;
  criticalBranchCoverage: number;
}

export function competitionScoreBps(report: CompetitionScoreInput) {
  if (!report.passed) return 0;
  return Math.max(1, Math.round(10_000 * (
    report.lineCoverage * 0.25 + report.branchCoverage * 0.25 +
    report.functionCoverage * 0.2 + report.criticalBranchCoverage * 0.3
  )));
}

export function competitionWeightsBps(scores: number[], winnerIndex: number) {
  if (!scores.length || winnerIndex < 0 || winnerIndex >= scores.length || scores.some((score) => !Number.isInteger(score) || score < 0 || score > 10_000)) {
    throw new Error("COMPETITION_SCORES_INVALID");
  }
  const total = scores.reduce((sum, score) => sum + score, 0);
  if (!total) return [];
  const weights = scores.map((score) => Math.floor(score * 10_000 / total));
  weights[winnerIndex] += 10_000 - weights.reduce((sum, weight) => sum + weight, 0);
  return weights;
}
