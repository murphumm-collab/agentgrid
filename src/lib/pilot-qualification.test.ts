import { describe, expect, it } from "vitest";
import type { BusinessAdoption, TestResult } from "./types";
import { assessPilotQualification, type PilotQualificationTask } from "./pilot-qualification";
import type { VerifiedPilotSignoffBundle } from "./pilot-signoff";

const publishers = ["0x1000000000000000000000000000000000000001", "0x1000000000000000000000000000000000000002", "0x1000000000000000000000000000000000000003"];
const executors = ["0x2000000000000000000000000000000000000001", "0x2000000000000000000000000000000000000002", "0x2000000000000000000000000000000000000003"];
const testers = ["0x3000000000000000000000000000000000000001", "0x3000000000000000000000000000000000000002", "0x3000000000000000000000000000000000000003"];
const deploymentManifestSha256 = `sha256:${"a".repeat(64)}`;

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
    executionMode: index === 1 ? "COMPETITION" : "COLLABORATION", executorIds: [executors[index]], testerId: testers[index],
    testResult: evidence(index), businessAdoption: adoption(index),
    } as PilotQualificationTask)),
    { id: "4", publisher: publishers[0], state: "COMPLETED", executionMode: "COLLABORATION", executorIds: [executors[0]], testerId: testers[0], testResult: null },
    { id: "5", publisher: publishers[1], state: "COMPLETED", executionMode: "COLLABORATION", executorIds: [executors[1]], testerId: testers[1], testResult: null },
  ];
}

const events = [
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
      { role: "AGENT_INDEPENDENCE_REVIEW", signer: "0x4000000000000000000000000000000000000002", subjectAddresses: [...executors, ...testers], evidenceHash: `sha256:${"c".repeat(64)}`, signedAt: "2026-08-31T02:00:00.000Z", attestationHash: `0x${"2".repeat(64)}` },
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
    expect(report.observed).toMatchObject({ adoptedTasks: 3, publisherWallets: 3, agentWallets: 6, disputeResolved: true, maintenanceLifecycleComplete: true, repeatedCombinationDecayObserved: true });
  });

  it("fails closed on missing real use, role separation, lifecycle evidence and signoffs", () => {
    const incomplete = tasks().slice(0, 2);
    incomplete[0].executorIds = [incomplete[0].publisher];
    const report = assessPilotQualification({ tasks: incomplete, events: [], validAdoptions: validAdoptions().slice(0, 2), signoffStatus: "missing" });
    expect(report.launchEvidenceReady).toBe(false);
    expect(report.blockers).toEqual(expect.arrayContaining([
      "PILOT_REAL_ADOPTED_TASKS_3_REQUIRED", "PILOT_DISTINCT_PUBLISHERS_3_REQUIRED", "PILOT_PUBLISHER_AGENT_ROLE_OVERLAP",
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
});
