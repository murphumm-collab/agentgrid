import { describe, expect, it } from "vitest";
import { aggregateCriterionVotes, aggregateExecutorWeights, assertVerificationCoverage, createVerificationPlan, verificationCommitment } from "./verification-panel";

describe("verification panel", () => {
  it("assigns every criterion to exactly two isolated shards", () => {
    const ids = ["criterion-1", "criterion-2", "criterion-3", "criterion-4"];
    const plan = createVerificationPlan(ids);
    expect(() => assertVerificationCoverage(plan, ids)).not.toThrow();
    for (const id of ids) expect(plan.shards.filter((shard) => shard.criterionIds.includes(id))).toHaveLength(2);
    expect(plan.shards.every((shard) => shard.criterionIds.length < ids.length)).toBe(true);
  });

  it("keeps a two-criterion panel useful with the minimum unavoidable overlap", () => {
    const ids = ["criterion-1", "criterion-2"];
    const plan = createVerificationPlan(ids);
    expect(() => assertVerificationCoverage(plan, ids)).not.toThrow();
    expect(plan.shards.map((shard) => shard.criterionIds)).toEqual([["criterion-1"], ["criterion-1", "criterion-2"], ["criterion-2"]]);
  });

  it("requires two independent passing votes for each criterion", () => {
    expect(aggregateCriterionVotes([
      { shard: 0, criterionId: "criterion-1", passed: true },
      { shard: 1, criterionId: "criterion-1", passed: true },
      { shard: 1, criterionId: "criterion-2", passed: true },
      { shard: 2, criterionId: "criterion-2", passed: false },
    ], ["criterion-1", "criterion-2"])).toEqual([
      { criterionId: "criterion-1", passed: true }, { criterionId: "criterion-2", passed: false },
    ]);
  });

  it("weights earlier independent commitments and normalizes rounding", () => {
    expect(aggregateExecutorWeights([
      { commitOrder: 0, executorWeightsBps: [8_000, 2_000] },
      { commitOrder: 1, executorWeightsBps: [5_000, 5_000] },
      { commitOrder: 2, executorWeightsBps: [2_000, 8_000] },
    ])).toEqual([5_400, 4_600]);
  });

  it("binds task, round, shard, report and private salt", () => {
    const base = { taskId: "7", workRound: 2, shard: 1, reportHash: `0x${"a".repeat(64)}`, salt: `0x${"b".repeat(64)}` };
    expect(verificationCommitment(base)).not.toBe(verificationCommitment({ ...base, shard: 2 }));
  });
});
