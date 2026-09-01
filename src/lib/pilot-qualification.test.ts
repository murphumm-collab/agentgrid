import { describe, expect, it } from "vitest";
import type { BusinessAdoption, TestResult } from "./types";
import { assessPilotQualification, type PilotQualificationTask } from "./pilot-qualification";
import type { VerifiedPilotSignoffBundle } from "./pilot-signoff";

const publishers = ["0x1000000000000000000000000000000000000001", "0x1000000000000000000000000000000000000002", "0x1000000000000000000000000000000000000003"];
const executors = ["0x2000000000000000000000000000000000000001", "0x2000000000000000000000000000000000000002", "0x2000000000000000000000000000000000000003"];
const testers = ["0x3000000000000000000000000000000000000001", "0x3000000000000000000000000000000000000002", "0x3000000000000000000000000000000000000003"];
const evaluators = ["0x3100000000000000000000000000000000000001", "0x3100000000000000000000000000000000000002", "0x3100000000000000000000000000000000000003"];
const arbitrators = ["0x3200000000000000000000000000000000000001", "0x3200000000000000000000000000000000000002", "0x3200000000000000000000000000000000000003"];
const challenger = "0x3300000000000000000000000000000000000001";
const deploymentManifestSha256 = `sha256:${"a".repeat(64)}`;
const tokens = (amount: number) => `${BigInt(amount) * (BigInt(10) ** BigInt(18))}`;

function evidence(index: number): TestResult {
  return {
    testerId: testers[index], passed: true, failures: [], testsPassed: true, hiddenTestsPassed: true,
    lineCoverage: 0.95, branchCoverage: 0.92, criticalBranchCoverage: 0.98,
    artifactHash: `sha256:${String(index + 1).repeat(64)}`, submittedAt: "2026-08-31T00:00:00.000Z", selectionProof: `proof-${index}`,
  };
}

function adoption(index: number): BusinessAdoption {
  return {
    publisher: publishers[index], artifactHash: `sha256:${String(index + 1).repeat(64)}`,
    workflowType: "PRODUCTION_DEPLOYED", workflowEvidenceHash: `sha256:${String(index + 4).repeat(64)}`,
    adoptedAt: "2026-08-31T01:00:00.000Z", reportHash: `0x${String(index + 7).repeat(64)}`, attestedAt: "2026-08-31T01:01:00.000Z",
  };
}

function tasks(): PilotQualificationTask[] {
  return [
    ...publishers.map((publisher, index) => ({
    id: String(index + 1), publisher, state: index === 0 ? "COMPLETED" : "MAINTENANCE",
    executionMode: index === 1 ? "COMPETITION" : "COLLABORATION", executorIds: [executors[index]], testerId: testers[0], testerIds: testers,
    testResult: evidence(index), businessAdoption: adoption(index),
    } as PilotQualificationTask)),
    { id: "4", publisher: publishers[0], state: "COMPLETED", executionMode: "COLLABORATION", executorIds: [executors[0]], testerId: testers[0], testResult: null },
    { id: "5", publisher: publishers[1], state: "COMPLETED", executionMode: "COLLABORATION", executorIds: [executors[1]], testerId: testers[1], testResult: null },
  ];
}

function panelEvents(taskId: string) {
  const common = { taskId, workRound: 1, epoch: 1 };
  return [
    { eventName: "PanelStarted", eventArgs: { ...common, checkpoint: 0, testers, criterionMasks: [3, 5, 6] } },
    ...testers.map((tester, shard) => ({ eventName: "ShardCommitted", eventArgs: { ...common, tester, shard, commitOrder: shard } })),
    ...testers.map((tester, shard) => ({ eventName: "ShardRevealed", eventArgs: { ...common, tester, shard } })),
  ];
}

function challengeEvents(taskId: string, caseDigit: string, upheld: boolean, penaltyBps: number, falseCount: number, voters: string[]) {
  const caseId = `0x${caseDigit.repeat(64)}`;
  const resolutionHash = `0x${(Number(caseDigit) + 4).toString().repeat(64)}`;
  return [
    { eventName: "VerificationChallengeOpened", eventArgs: { taskId, caseId, challenger, validator: testers[0], challengerStakeSnapshot: tokens(500), validatorStakeLocked: tokens(100) } },
    ...voters.map((arbitrator) => ({ eventName: "VerificationChallengeVote", eventArgs: { taskId, caseId, arbitrator, upheld, resolutionHash } })),
    { eventName: "VerificationChallengeResolved", eventArgs: {
      taskId, caseId, upheld, resolutionHash,
      challengerSlash: upheld ? "0" : (BigInt(tokens(500)) * BigInt(penaltyBps) / BigInt(10_000)).toString(),
      validatorSlash: upheld ? tokens(100) : "0", challengerReward: upheld ? tokens(60) : "0",
      challengerPenaltyBps: penaltyBps, challengerFalseChallengeCount: falseCount,
    } },
  ];
}

const events = [
  ...arbitrators.map((agent) => ({ eventName: "ArbitrationStakeDeposited", eventArgs: { agent, amount: tokens(500), totalStake: tokens(500) } })),
  { eventName: "ArbitrationStakeDeposited", eventArgs: { agent: challenger, amount: tokens(500), totalStake: tokens(500) } },
  ...["1", "2", "3"].flatMap((taskId) => [
    { eventName: "TaskEvaluatorsAssigned", eventArgs: { taskId, evaluator0: evaluators[0], evaluator1: evaluators[1], evaluator2: evaluators[2] } },
    ...panelEvents(taskId),
  ]),
  ...challengeEvents("1", "1", true, 0, 0, [arbitrators[0], arbitrators[1]]),
  ...challengeEvents("2", "2", false, 500, 1, [arbitrators[0], arbitrators[1]]),
  ...challengeEvents("3", "3", false, 1_500, 2, [arbitrators[1], arbitrators[2]]),
  ...challengeEvents("4", "4", false, 3_000, 3, [arbitrators[0], arbitrators[2]]),
  { eventName: "RehabilitationAppealOpened", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"a".repeat(64)}`, stakeSnapshot: tokens(500) } },
  { eventName: "RehabilitationAppealVote", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"a".repeat(64)}`, arbitrator: arbitrators[0], upheld: true, resolutionHash: `0x${"d".repeat(64)}` } },
  { eventName: "RehabilitationAppealVote", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"a".repeat(64)}`, arbitrator: arbitrators[1], upheld: true, resolutionHash: `0x${"d".repeat(64)}` } },
  { eventName: "RehabilitationAppealResolved", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"a".repeat(64)}`, upheld: true, resolutionHash: `0x${"d".repeat(64)}`, appellantSlash: "0" } },
  { eventName: "RehabilitationAppealOpened", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"b".repeat(64)}`, stakeSnapshot: tokens(500) } },
  { eventName: "RehabilitationAppealVote", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"b".repeat(64)}`, arbitrator: arbitrators[0], upheld: false, resolutionHash: `0x${"e".repeat(64)}` } },
  { eventName: "RehabilitationAppealVote", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"b".repeat(64)}`, arbitrator: arbitrators[2], upheld: false, resolutionHash: `0x${"e".repeat(64)}` } },
  { eventName: "RehabilitationAppealResolved", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"b".repeat(64)}`, upheld: false, resolutionHash: `0x${"e".repeat(64)}`, appellantSlash: tokens(25) } },
  { eventName: "RehabilitationAppealOpened", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"c".repeat(64)}`, stakeSnapshot: tokens(500) } },
  { eventName: "RehabilitationAppealExpired", eventArgs: { appellant: challenger, role: 2, caseId: `0x${"c".repeat(64)}` } },
  { eventName: "RejectionResolved", eventArgs: { taskId: "4", executorWins: true } },
  { eventName: "MaintenanceValidated", eventArgs: { taskId: "1", checkpoint: 1, passed: true } },
  { eventName: "MaintenanceValidated", eventArgs: { taskId: "1", checkpoint: 2, passed: true } },
  { eventName: "MaintenanceValidated", eventArgs: { taskId: "1", checkpoint: 3, passed: true } },
  { eventName: "GrantCreated", eventArgs: { taskId: "5", multiplierBps: 8_500 } },
];

function signoff(): VerifiedPilotSignoffBundle {
  const ownerRoles = ["SUPPORT_OWNER", "DISPUTE_OWNER", "INCIDENT_RESPONSE_OWNER", "ROLLBACK_OWNER"] as const;
  return {
    pilotId: "pilot-2026-08-31",
    deploymentManifestSha256,
    taskIds: ["1", "2", "3", "4", "5"],
    taskSetHash: `0x${"0".repeat(64)}`,
    attestations: [
      { role: "PUBLISHER_INDEPENDENCE_REVIEW", signer: "0x4000000000000000000000000000000000000001", subjectAddresses: publishers, evidenceHash: `sha256:${"b".repeat(64)}`, signedAt: "2026-08-31T02:00:00.000Z", attestationHash: `0x${"1".repeat(64)}` },
      { role: "AGENT_INDEPENDENCE_REVIEW", signer: "0x4000000000000000000000000000000000000002", subjectAddresses: [...executors, ...testers, ...evaluators, ...arbitrators, challenger], evidenceHash: `sha256:${"c".repeat(64)}`, signedAt: "2026-08-31T02:00:00.000Z", attestationHash: `0x${"2".repeat(64)}` },
      ...ownerRoles.map((role, index) => ({ role, signer: `0x500000000000000000000000000000000000000${index + 1}` as `0x${string}`, subjectAddresses: [], evidenceHash: `sha256:${String(index + 3).repeat(64)}`, signedAt: "2026-08-31T02:00:00.000Z", attestationHash: `0x${String(index + 3).repeat(64)}` as `0x${string}` })),
    ],
  };
}

function validAdoptions() {
  return tasks().filter((task) => task.businessAdoption).map((task) => ({ taskId: task.id, publisher: task.publisher, artifactHash: task.businessAdoption!.artifactHash, reportHash: task.businessAdoption!.reportHash }));
}

describe("real-pilot qualification gate", () => {
  it("requires all technical evidence and deployment-bound external signatures", () => {
    const report = assessPilotQualification({ tasks: tasks(), events, validAdoptions: validAdoptions(), signoff: signoff(), signoffStatus: "verified", deploymentManifestSha256 });
    expect(report.technicalEvidenceReady).toBe(true);
    expect(report.launchEvidenceReady).toBe(true);
    expect(report.blockers).toEqual([]);
    expect(report.observed).toMatchObject({
      adoptedTasks: 3, publisherWallets: 3, agentWallets: 13,
      validatorWallets: 3, evaluatorWallets: 3, stakedArbitratorWallets: 3,
      completeShardedValidationTasks: 3, correctChallengeAccountingObserved: true,
      falseChallengePenaltySequenceObserved: true, disputeResolved: true,
      rehabilitationAppealLifecycleObserved: true,
      maintenanceLifecycleComplete: true, repeatedCombinationDecayObserved: true,
    });
  });

  it("fails closed on missing real use, role separation, lifecycle evidence and signoffs", () => {
    const incomplete = tasks().slice(0, 2);
    incomplete[0].executorIds = [incomplete[0].publisher];
    const report = assessPilotQualification({ tasks: incomplete, events: [], validAdoptions: validAdoptions().slice(0, 2), signoffStatus: "missing" });
    expect(report.launchEvidenceReady).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      "PILOT_REAL_ADOPTED_TASKS_3_REQUIRED", "PILOT_DISTINCT_PUBLISHERS_3_REQUIRED", "PILOT_PUBLISHER_AGENT_ROLE_OVERLAP",
      "PILOT_COMPLETE_SHARDED_VALIDATION_REQUIRED", "PILOT_DISTINCT_VALIDATORS_3_REQUIRED", "PILOT_DISTINCT_EVALUATORS_3_REQUIRED",
      "PILOT_STAKED_ARBITRATORS_3_REQUIRED", "PILOT_CORRECT_CHALLENGE_ACCOUNTING_REQUIRED", "PILOT_FALSE_CHALLENGE_5_15_30_REQUIRED",
      "PILOT_REHABILITATION_APPEAL_LIFECYCLE_REQUIRED",
      "PILOT_DISPUTE_RESOLUTION_REQUIRED", "PILOT_MAINTENANCE_7_30_90_REQUIRED", "PILOT_REPEAT_COLLABORATION_DECAY_REQUIRED",
      "PILOT_SIGNOFF_FILE_MISSING", "PILOT_PUBLISHER_INDEPENDENCE_REVIEW_REQUIRED", "PILOT_AGENT_INDEPENDENCE_REVIEW_REQUIRED",
    ]));
  });

  it("rejects invalid adoption rows and a signoff for another deployment", () => {
    const report = assessPilotQualification({ tasks: tasks(), events, validAdoptions: validAdoptions(), invalidAdoptionRows: 1, signoff: signoff(), signoffStatus: "verified", deploymentManifestSha256: `sha256:${"f".repeat(64)}` });
    expect(report.blockers).toContain("PILOT_ADOPTION_SIGNATURE_INVALID");
    expect(report.blockers).toContain("PILOT_SIGNOFF_DEPLOYMENT_HASH_MISMATCH");
    expect(report.launchEvidenceReady).toBe(false);
  });

  it("cannot satisfy pilot lifecycle gates with historic events outside the signed task set", () => {
    const scopedSignoff = signoff();
    scopedSignoff.taskIds = ["1", "2", "3"];
    const report = assessPilotQualification({ tasks: tasks(), events, validAdoptions: validAdoptions(), signoff: scopedSignoff, signoffStatus: "verified", deploymentManifestSha256 });
    expect(report.blockers).toEqual(expect.arrayContaining(["PILOT_DISPUTE_RESOLUTION_REQUIRED", "PILOT_REPEAT_COLLABORATION_DECAY_REQUIRED"]));
    expect(report.launchEvidenceReady).toBe(false);
  });

  it("rejects a launch sign-off collected before the latest business adoption", () => {
    const earlySignoff = signoff();
    earlySignoff.attestations[0].signedAt = "2026-08-31T00:00:00.000Z";
    const report = assessPilotQualification({ tasks: tasks(), events, validAdoptions: validAdoptions(), signoff: earlySignoff, signoffStatus: "verified", deploymentManifestSha256 });
    expect(report.blockers).toContain("PILOT_SIGNOFF_PREDATES_ADOPTION");
    expect(report.launchEvidenceReady).toBe(false);
  });

  it("does not count an adoption signature bound to another publisher or report", () => {
    const substituted = validAdoptions();
    substituted[0] = { ...substituted[0], publisher: publishers[1], reportHash: `0x${"f".repeat(64)}` };
    const report = assessPilotQualification({ tasks: tasks(), events, validAdoptions: substituted, signoff: signoff(), signoffStatus: "verified", deploymentManifestSha256 });
    expect(report.observed.adoptedTasks).toBe(2);
    expect(report.blockers).toContain("PILOT_REAL_ADOPTED_TASKS_3_REQUIRED");
    expect(report.launchEvidenceReady).toBe(false);
  });

  it("rejects incomplete shards, unstaked quorum members, forged penalty tiers and missing rehabilitation expiry", () => {
    const tampered = events
      .filter((event) => !(event.eventName === "ShardRevealed" && event.eventArgs?.taskId === "2" && event.eventArgs?.shard === 2))
      .filter((event) => !(event.eventName === "ArbitrationStakeDeposited" && event.eventArgs?.agent === arbitrators[2]))
      .filter((event) => event.eventName !== "RehabilitationAppealExpired")
      .map((event) => event.eventName === "VerificationChallengeResolved" && event.eventArgs?.taskId === "4"
        ? { ...event, eventArgs: { ...event.eventArgs, challengerPenaltyBps: 1_500 } }
        : event);
    const report = assessPilotQualification({ tasks: tasks(), events: tampered, validAdoptions: validAdoptions(), signoff: signoff(), signoffStatus: "verified", deploymentManifestSha256 });
    expect(report.blockers).toEqual(expect.arrayContaining([
      "PILOT_COMPLETE_SHARDED_VALIDATION_REQUIRED",
      "PILOT_STAKED_ARBITRATORS_3_REQUIRED",
      "PILOT_FALSE_CHALLENGE_5_15_30_REQUIRED",
      "PILOT_REHABILITATION_APPEAL_LIFECYCLE_REQUIRED",
    ]));
    expect(report.launchEvidenceReady).toBe(false);
  });

  it("rejects an evaluator that also occupies a validator shard", () => {
    const overlapped = events.map((event) => event.eventName === "TaskEvaluatorsAssigned"
      ? { ...event, eventArgs: { ...event.eventArgs, evaluator0: testers[0] } }
      : event);
    const report = assessPilotQualification({ tasks: tasks(), events: overlapped, validAdoptions: validAdoptions(), signoff: signoff(), signoffStatus: "verified", deploymentManifestSha256 });
    expect(report.blockers).toContain("PILOT_AGENT_ROLE_OVERLAP");
    expect(report.launchEvidenceReady).toBe(false);
  });

  it("rejects a declared penalty tier whose transferred slash does not match the locked snapshot", () => {
    const tampered = events.map((event) => event.eventName === "VerificationChallengeResolved" && event.eventArgs?.taskId === "3"
      ? { ...event, eventArgs: { ...event.eventArgs, challengerSlash: tokens(1) } }
      : event);
    const report = assessPilotQualification({ tasks: tasks(), events: tampered, validAdoptions: validAdoptions(), signoff: signoff(), signoffStatus: "verified", deploymentManifestSha256 });
    expect(report.blockers).toContain("PILOT_FALSE_CHALLENGE_5_15_30_REQUIRED");
    expect(report.launchEvidenceReady).toBe(false);
  });
});
