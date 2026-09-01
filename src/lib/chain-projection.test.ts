import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { projectAgentQualities, projectAgentStatuses, projectChainBusiness } from "./chain-projection";
import type { ChainProjectionRow, CommitmentProjectionRow } from "./store-postgres";

const event = (eventName: string, eventArgs: Record<string, string | number | boolean | Array<string | number | boolean>>, blockNumber: string): ChainProjectionRow => ({
  eventName, eventArgs, blockNumber, transactionHash: `0x${blockNumber.padStart(64, "0")}`,
  blockTimestamp: new Date(Date.parse("2026-01-01T00:00:00.000Z") + Number(blockNumber) * 1_000).toISOString(),
});

describe("confirmed chain business projection", () => {
  it("folds the latest canonical Agent activation status by wallet", () => {
    const statuses = projectAgentStatuses([
      event("AgentStatusUpdated", { agent: "0xAgent", active: true }, "1"),
      event("AgentStatusUpdated", { agent: "0xOther", active: false }, "2"),
      event("AgentStatusUpdated", { agent: "0xAgent", active: false }, "3"),
    ]);
    expect(statuses.get("0xagent")).toBe(false);
    expect(statuses.get("0xother")).toBe(false);
  });

  it("projects role-isolated quality, cooldown, ban and evidence-bound rehabilitation", () => {
    const qualities = projectAgentQualities([
      event("AgentQualityUpdated", { agent: "0xAgent", role: 2, scoreBps: 2200, outcomeCount: 4, severeFaults: 2, cooldownUntil: 1_800_000_000, banned: false }, "1"),
      event("AgentQualityUpdated", { agent: "0xAgent", role: 1, scoreBps: 6400, outcomeCount: 8, severeFaults: 0, cooldownUntil: 0, banned: false }, "2"),
      event("AgentQualityUpdated", { agent: "0xAgent", role: 2, scoreBps: 700, outcomeCount: 5, severeFaults: 3, cooldownUntil: 1_800_000_100, banned: true }, "3"),
      event("AgentRoleRehabilitated", { agent: "0xAgent", role: 2, evidenceHash: `0x${"a".repeat(64)}` }, "4"),
    ]).get("0xagent");
    expect(qualities).toEqual({
      executor: { scoreBps: 6400, outcomeCount: 8, severeFaults: 0, cooldownUntil: null, banned: false },
      validator: { scoreBps: 2500, outcomeCount: 5, severeFaults: 2, cooldownUntil: null, banned: false },
      evaluator: { scoreBps: 5000, outcomeCount: 0, severeFaults: 0, cooldownUntil: null, banned: false },
    });
  });

  it("folds stake, task lifecycle, maintenance and rewards", () => {
    const commitment: CommitmentProjectionRow = {
      specHash: `0x${"1".repeat(64)}`, publisher: "0xPublisher", status: "CONFIRMED", chainTaskId: "9",
      createdAt: "2026-01-01T00:00:00.000Z", confirmedAt: "2026-01-01T00:01:00.000Z",
      spec: { stakePositionId: 3, title: "Deploy checkout monitor", description: "Deploy a monitored checkout service with tests and rollback support.", category: "Development", maxExecutors: 1, declaredDurationHours: 48, criteria: ["Critical tests pass"] },
    };
    const result = projectChainBusiness({ commitments: [commitment], events: [
      event("PositionCreated", { positionId: "3", owner: "0xPublisher", amount: parseEther("1000").toString() }, "1"),
      event("CreditIssued", { positionId: "3", expiresAt: 1_800_000_000 }, "2"),
      event("TaskSourceFrozen", { taskId: "9", requestedSourceId: `0x${"8".repeat(64)}`, effectiveSourceId: `0x${"8".repeat(64)}`, recipient: "0xSource", fallbackToDao: false }, "2"),
      event("VestingCreated", { vestingId: `0x${"a".repeat(64)}`, recipient: "0xDao", amount: parseEther("0.4").toString(), unlockAt: 1_800_000_000 }, "2"),
      event("VestingCreated", { vestingId: `0x${"b".repeat(64)}`, recipient: "0xSource", amount: parseEther("0.3").toString(), unlockAt: 1_800_000_000 }, "2"),
      event("LifecycleChargeRouted", { taskId: "9", stage: 0, stakeBasis: parseEther("1000").toString(), amount: parseEther("2").toString(), rewardVaultAmount: parseEther("0.7").toString(), burnAmount: parseEther("0.4").toString(), daoAmount: parseEther("0.4").toString(), sourceAmount: parseEther("0.3").toString(), securityAmount: parseEther("0.2").toString(), daoVestingId: `0x${"a".repeat(64)}`, sourceVestingId: `0x${"b".repeat(64)}` }, "2"),
      event("LifecycleFeeCharged", { positionId: "3", taskId: "9", stage: 0, stakeBasis: parseEther("1000").toString(), amount: parseEther("2").toString() }, "2"),
      event("TaskCreated", { taskId: "9", publisher: "0xPublisher", positionId: "3", specHash: commitment.specHash }, "3"),
      event("CreditConsumed", { positionId: "3", taskId: "9" }, "3"),
      event("TaskClaimed", { taskId: "9", executor: "0xExecutor" }, "4"),
      event("TeamClosed", { taskId: "9", executorCount: "1" }, "4"),
      event("ContributionSubmitted", { taskId: "9", executor: "0xExecutor", workRound: "1", contributionHash: `0x${"a".repeat(64)}` }, "4"),
      event("WorkSubmitted", { taskId: "9", artifactHash: `0x${"2".repeat(64)}` }, "5"),
      event("TesterAssigned", { taskId: "9", tester: "0xTester", selectionProof: `0x${"3".repeat(64)}` }, "6"),
      event("ExecutorQualityMultipliersFrozen", { taskId: "9", workRound: 1, epoch: 1, multipliersBps: [10_800] }, "6"),
      event("TestSubmitted", { taskId: "9", passed: true, evidenceHash: `0x${"4".repeat(64)}` }, "7"),
      event("UserReviewed", { taskId: "9", accepted: true, reasonHash: `0x${"0".repeat(64)}` }, "8"),
      event("VestingCreated", { vestingId: `0x${"c".repeat(64)}`, recipient: "0xDao", amount: parseEther("6").toString(), unlockAt: 1_800_000_100 }, "8"),
      event("VestingCreated", { vestingId: `0x${"d".repeat(64)}`, recipient: "0xSource", amount: parseEther("4").toString(), unlockAt: 1_800_000_100 }, "8"),
      event("TaskRewardRouted", { taskId: "9", grossReward: parseEther("200").toString(), agentPool: parseEther("190").toString(), daoAmount: parseEther("6").toString(), sourceAmount: parseEther("4").toString(), daoVestingId: `0x${"c".repeat(64)}`, sourceVestingId: `0x${"d".repeat(64)}` }, "8"),
      event("GrantCreated", { taskId: "9", grossReward: parseEther("200").toString(), multiplierBps: "10000", issuanceProof: `0x${"5".repeat(64)}` }, "8"),
      event("CheckpointApproved", { taskId: "9", checkpoint: "1" }, "9"),
      event("MaintenanceValidated", { taskId: "9", checkpoint: "1", passed: true, evidenceHash: `0x${"6".repeat(64)}` }, "9"),
      event("RewardClaimed", { taskId: "9", checkpoint: "0", amount: parseEther("76").toString() }, "10"),
    ] });
    expect(result.positions[0]).toMatchObject({ id: "3", amount: 998, activeTaskId: "9" });
    expect(result.tasks[0]).toMatchObject({ id: "9", state: "MAINTENANCE", executorIds: ["0xExecutor"], executorQualityMultipliersBps: [10_800], teamClosed: true, contributionHashes: { "0xexecutor": `0x${"a".repeat(64)}` }, testerId: "0xTester", maintenanceHealthy: [true, false, false], economics: { sourceRecipient: "0xSource", grossReward: 200, agentPool: 190 } });
    expect(result.rewards[0].total).toBe(190);
    expect(result.rewards[0].tranches.map((item) => item.status)).toEqual(["CLAIMED", "CLAIMABLE", "LOCKED", "LOCKED"]);
    expect(result.rewards[0].tranches[1].dueAt).toBe("2026-01-08T00:00:08.000Z");
    expect(result.economics).toMatchObject({ grossTaskRewards: 200, agentPool: 190, daoVested: 6.4, sourceVested: 4.3, lifecycleConsumed: 2, rewardVaultRecycled: 0.7, burned: 0.4, securityReserved: 0.2, netDemand30d: { status: "UNAVAILABLE" } });
  });

  it("applies slashing and releases the slot after completion", () => {
    const result = projectChainBusiness({ commitments: [], events: [
      event("PositionCreated", { positionId: "1", owner: "0xPublisher", amount: parseEther("1000").toString() }, "1"),
      event("CreditConsumed", { positionId: "1", taskId: "2" }, "2"),
      event("PositionSlashed", { positionId: "1", taskId: "2", amount: parseEther("50").toString(), recipient: "0xVault" }, "3"),
      event("PositionReleased", { positionId: "1", taskId: "2" }, "4"),
    ] });
    expect(result.positions[0]).toMatchObject({ amount: 950, activeTaskId: null });
  });

  it("does not publish a TaskCreated event whose local commitment was rejected", () => {
    const commitment: CommitmentProjectionRow = {
      specHash: `0x${"4".repeat(64)}`, publisher: "0xPublisher", status: "REJECTED", chainTaskId: "44",
      createdAt: "2026-01-01T00:00:00.000Z", confirmedAt: null,
      spec: { title: "Rejected capability mismatch", description: "A task whose tester mask did not match its committed completion criteria.", category: "Development", maxExecutors: 1, declaredDurationHours: 24, criteria: ["Tests pass"] },
    };
    const result = projectChainBusiness({ commitments: [commitment], events: [
      event("TaskCreated", { taskId: "44", publisher: "0xPublisher", positionId: "5", specHash: commitment.specHash }, "1"),
    ] });
    expect(result.tasks).toEqual([]);
  });

  it("uses the canonical completing block time instead of task creation time", () => {
    const commitment: CommitmentProjectionRow = {
      specHash: `0x${"5".repeat(64)}`, publisher: "0xPublisher", status: "CONFIRMED", chainTaskId: "45",
      createdAt: "2025-12-01T00:00:00.000Z", confirmedAt: "2025-12-01T00:01:00.000Z",
      spec: { title: "Complete monitored workflow", description: "A task with a canonical completion checkpoint timestamp for public reporting.", category: "Operations", maxExecutors: 1, declaredDurationHours: 24, criteria: ["Maintenance passes"] },
    };
    const result = projectChainBusiness({ commitments: [commitment], events: [
      event("TaskCreated", { taskId: "45", publisher: "0xPublisher", positionId: "6", specHash: commitment.specHash }, "1"),
      event("MaintenanceValidated", { taskId: "45", checkpoint: "3", passed: true, evidenceHash: `0x${"6".repeat(64)}` }, "9"),
    ] });
    expect(result.tasks[0]).toMatchObject({ state: "COMPLETED", createdAt: "2026-01-01T00:00:01.000Z", publishedAt: "2026-01-01T00:00:01.000Z", completedAt: "2026-01-01T00:00:09.000Z" });
  });

  it("projects the private evaluation lifecycle before marketplace publication", () => {
    const commitment: CommitmentProjectionRow = {
      specHash: `0x${"7".repeat(64)}`, publisher: "0xPublisher", status: "CONFIRMED", chainTaskId: "12",
      createdAt: "2026-01-01T00:00:00.000Z", confirmedAt: "2026-01-01T00:02:00.000Z",
      spec: { title: "Evaluate settlement monitoring", description: "Build a measurable settlement monitoring workflow with deterministic alert tests.", category: "Automation", maxExecutors: 3, declaredDurationHours: 24, criteria: ["All tests pass", "Coverage exceeds 95%"] },
    };
    const result = projectChainBusiness({ commitments: [commitment], events: [
      event("TaskEvaluationRequested", { taskId: "12", publisher: "0xPublisher", positionId: "8", specHash: commitment.specHash, deadline: "1800000000" }, "1"),
      event("TaskEvaluatorsAssigned", { taskId: "12", evaluator0: "0xA", evaluator1: "0xB", evaluator2: "0xC", selectionProof: `0x${"8".repeat(64)}` }, "2"),
      event("TaskEvaluationSubmitted", { taskId: "12", evaluator: "0xA", approve: true, categoryHash: `0x${"9".repeat(64)}`, reportHash: `0x${"a".repeat(64)}` }, "3"),
      event("TaskEvaluationSubmitted", { taskId: "12", evaluator: "0xB", approve: true, categoryHash: `0x${"9".repeat(64)}`, reportHash: `0x${"b".repeat(64)}` }, "4"),
      event("TaskEvaluationSubmitted", { taskId: "12", evaluator: "0xC", approve: true, categoryHash: `0x${"9".repeat(64)}`, reportHash: `0x${"c".repeat(64)}` }, "5"),
      event("TaskEvaluationFinalized", { taskId: "12", approved: true, categoryHash: `0x${"9".repeat(64)}`, difficultyBps: "7200", estimatedHours: "30", testabilityBps: "9400", requestedReward: parseEther("900").toString() }, "6"),
      event("TaskCreated", { taskId: "12", publisher: "0xPublisher", positionId: "8", specHash: commitment.specHash }, "6"),
    ] });
    expect(result.tasks[0]).toMatchObject({ id: "12", state: "OPEN", category: "Automation", evaluation: { status: "APPROVED", completed: 3, approvals: 3, difficulty: 0.72, estimatedHours: 30, testability: 0.94, effectiveReward: 900 } });

    const rejected = projectChainBusiness({ commitments: [{ ...commitment, status: "REJECTED" }], events: [
      event("TaskEvaluationRequested", { taskId: "12", publisher: "0xPublisher", positionId: "8", specHash: commitment.specHash, deadline: "1800000000" }, "1"),
      event("TaskEvaluationFinalized", { taskId: "12", approved: false, categoryHash: `0x${"0".repeat(64)}`, difficultyBps: "0", estimatedHours: "0", testabilityBps: "0", requestedReward: parseEther("1000").toString() }, "2"),
    ] });
    expect(rejected.tasks[0]).toMatchObject({ state: "REJECTED", evaluation: { status: "REJECTED", passed: false } });
  });

  it("projects isolated competition candidates and only the selected artifact", () => {
    const commitment: CommitmentProjectionRow = {
      specHash: `0x${"d".repeat(64)}`, publisher: "0xPublisher", status: "CONFIRMED", chainTaskId: "15",
      createdAt: "2026-01-01T00:00:00.000Z", confirmedAt: "2026-01-01T00:02:00.000Z",
      spec: { title: "Compete on fraud detection", description: "Produce independently tested fraud detection candidates under the same hidden cases.", category: "Data", executionMode: "COMPETITION", maxExecutors: 2, declaredDurationHours: 24, criteria: ["Hidden cases pass"] },
    };
    const winnerHash = `0x${"e".repeat(64)}`;
    const result = projectChainBusiness({ commitments: [commitment], events: [
      event("TaskCreated", { taskId: "15", publisher: "0xPublisher", positionId: "9", specHash: commitment.specHash }, "1"),
      event("TaskExecutionModeSet", { taskId: "15", mode: "1" }, "1"),
      event("TaskClaimed", { taskId: "15", executor: "0xA" }, "2"),
      event("TaskClaimed", { taskId: "15", executor: "0xB" }, "3"),
      event("TeamClosed", { taskId: "15", executorCount: "2" }, "3"),
      event("ContributionSubmitted", { taskId: "15", executor: "0xA", workRound: "1", contributionHash: `0x${"a".repeat(64)}` }, "4"),
      event("ContributionSubmitted", { taskId: "15", executor: "0xB", workRound: "1", contributionHash: winnerHash }, "5"),
      event("CompetitionReady", { taskId: "15", workRound: "1", candidateCount: "2" }, "5"),
      event("TesterAssigned", { taskId: "15", tester: "0xTester", selectionProof: `0x${"f".repeat(64)}` }, "6"),
      event("CompetitionResultSubmitted", { taskId: "15", passed: true, winner: "0xB", artifactHash: winnerHash, evidenceHash: `0x${"1".repeat(64)}` }, "7"),
    ] });
    expect(result.tasks[0]).toMatchObject({
      id: "15", executionMode: "COMPETITION", state: "USER_REVIEW", executorIds: ["0xA", "0xB"],
      submission: { artifactHash: winnerHash, summary: "Competition winner 0xB" },
    });
  });

  it("projects maintenance failure into a repair round and returns the tested replacement to maintenance", () => {
    const commitment: CommitmentProjectionRow = {
      specHash: `0x${"2".repeat(64)}`, publisher: "0xPublisher", status: "CONFIRMED", chainTaskId: "21",
      createdAt: "2026-01-01T00:00:00.000Z", confirmedAt: "2026-01-01T00:02:00.000Z",
      spec: { title: "Repair production monitor", description: "Repair a monitored production workflow after independent maintenance regression detection.", category: "Operations", executionMode: "COLLABORATION", maxExecutors: 1, declaredDurationHours: 24, criteria: ["Regression test passes"] },
    };
    const repairedHash = `0x${"3".repeat(64)}`;
    const result = projectChainBusiness({ commitments: [commitment], events: [
      event("TaskCreated", { taskId: "21", publisher: "0xPublisher", positionId: "4", specHash: commitment.specHash }, "1"),
      event("TaskClaimed", { taskId: "21", executor: "0xExecutor" }, "2"),
      event("TeamClosed", { taskId: "21", executorCount: "1" }, "2"),
      event("UserReviewed", { taskId: "21", accepted: true, reasonHash: `0x${"0".repeat(64)}` }, "3"),
      event("MaintenanceValidated", { taskId: "21", checkpoint: "1", passed: false, evidenceHash: `0x${"4".repeat(64)}` }, "4"),
      event("MaintenanceRepairRequested", { taskId: "21", checkpoint: "1", workRound: "2", evidenceHash: `0x${"4".repeat(64)}` }, "4"),
      event("ExecutorEvicted", { taskId: "21", executor: "0xExecutor" }, "5"),
      event("TaskClaimed", { taskId: "21", executor: "0xReplacement" }, "5"),
      event("ContributionSubmitted", { taskId: "21", executor: "0xReplacement", workRound: "2", contributionHash: repairedHash }, "5"),
      event("WorkSubmitted", { taskId: "21", artifactHash: repairedHash }, "6"),
      event("TesterAssigned", { taskId: "21", tester: "0xTester", selectionProof: `0x${"5".repeat(64)}` }, "7"),
      event("FutureParticipantsUpdated", { taskId: "21", fromCheckpoint: "1", executors: ["0xReplacement"], executorWeightsBps: [10_000], tester: "0xRepairTester", executorWeightsHash: `0x${"7".repeat(64)}` }, "8"),
      event("MaintenanceValidated", { taskId: "21", checkpoint: "1", passed: true, evidenceHash: `0x${"6".repeat(64)}` }, "8"),
      event("TestSubmitted", { taskId: "21", passed: true, evidenceHash: `0x${"6".repeat(64)}` }, "8"),
    ] });
    expect(result.tasks[0]).toMatchObject({
      state: "MAINTENANCE", workRound: 2, maintenanceRepairCheckpoint: null,
      executorIds: ["0xReplacement"], submission: { artifactHash: repairedHash }, maintenanceHealthy: [true, false, false],
      maintenanceRewardDistribution: { fromCheckpoint: 1, executors: ["0xReplacement"], weightsBps: [10_000], tester: "0xRepairTester", proof: `0x${"7".repeat(64)}` },
    });
  });
});
