import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { operationalAlertAcknowledgementSignature } from "./operational-monitor";
import {
  monitoringEvidenceBindingBlockers, verifyMonitoringAlertDrillReport, type MonitoringAlertDrillReport,
} from "./monitoring-evidence";

const hashes = {
  deployment: `sha256:${"a".repeat(64)}`,
  alert: `sha256:${"b".repeat(64)}`,
  reminder: `sha256:${"c".repeat(64)}`,
  recovery: `sha256:${"d".repeat(64)}`,
  receiver: `sha256:${"e".repeat(64)}`,
};

function event(
  eventKind: "alert" | "reminder" | "recovery",
  sentAt: string,
  acknowledgedAt: string,
  bodySha256: string,
) {
  const deliveryId = randomUUID();
  const degraded = eventKind !== "recovery";
  const acknowledgement = {
    accepted: true as const,
    deliveryId,
    eventKind,
    bodySha256,
    signatureVerified: true as const,
    eventMatched: true as const,
    receivedAt: acknowledgedAt,
  };
  return {
    deliveryId,
    eventKind,
    status: degraded ? "degraded" : "ok",
    alerts: degraded ? ["MONITORING_ALERT_DRILL"] : [],
    sentAt,
    acknowledgedAt,
    latencyMs: new Date(acknowledgedAt).getTime() - new Date(sentAt).getTime(),
    bodySha256,
    acknowledgement: {
      ...acknowledgement,
      acknowledgementHmac: operationalAlertAcknowledgementSignature("t".repeat(32), acknowledgement),
    },
  };
}

function report(): MonitoringAlertDrillReport {
  return {
    version: 1,
    scope: "agentgrid-monitoring-alert-drill",
    chainId: 97,
    candidateBuildId: "candidate-build-123",
    deploymentManifestSha256: hashes.deployment,
    startedAt: "2026-08-31T00:00:00.000Z",
    observedAt: "2026-08-31T00:00:30.400Z",
    environment: "production",
    requestedReminderDelayMs: 30_000,
    target: {
      targetClass: "production-https",
      transport: "https",
      receiverProvider: "production-pager",
      receiverUrlHash: hashes.receiver,
      acknowledgementRequired: true,
      hmacSha256: true,
      redirectsRejected: true,
      timeoutMs: 10_000,
    },
    events: [
      event("alert", "2026-08-31T00:00:00.000Z", "2026-08-31T00:00:00.100Z", hashes.alert),
      event("reminder", "2026-08-31T00:00:30.100Z", "2026-08-31T00:00:30.200Z", hashes.reminder),
      event("recovery", "2026-08-31T00:00:30.200Z", "2026-08-31T00:00:30.300Z", hashes.recovery),
    ],
  } as MonitoringAlertDrillReport;
}

describe("monitoring alert drill evidence", () => {
  it("accepts exactly ordered, acknowledged alert/reminder/recovery evidence", () => {
    const verified = verifyMonitoringAlertDrillReport(report(), new Date("2026-08-31T00:01:00.000Z"));
    expect(verified.events).toHaveLength(3);
    expect(monitoringEvidenceBindingBlockers({
      report: verified,
      candidateBuildId: "candidate-build-123",
      candidateCreatedAt: "2026-08-30T23:59:00.000Z",
      deploymentManifestSha256: hashes.deployment,
      releaseCreatedAt: "2026-08-31T00:01:00.000Z",
    })).toEqual([]);
  });

  it("rejects substituted acknowledgements, duplicate deliveries and invalid chronology", () => {
    const mismatch = structuredClone(report());
    mismatch.events[1].acknowledgement.bodySha256 = hashes.alert;
    expect(() => verifyMonitoringAlertDrillReport(mismatch, new Date("2026-08-31T00:01:00.000Z"))).toThrow("MONITORING_EVIDENCE_ACKNOWLEDGEMENT_MISMATCH");

    const duplicate = structuredClone(report());
    duplicate.events[1].deliveryId = duplicate.events[0].deliveryId;
    duplicate.events[1].acknowledgement.deliveryId = duplicate.events[0].deliveryId;
    expect(() => verifyMonitoringAlertDrillReport(duplicate, new Date("2026-08-31T00:01:00.000Z"))).toThrow("MONITORING_EVIDENCE_DELIVERY_ID_REUSED");

    const earlyReminder = structuredClone(report());
    earlyReminder.events[1].sentAt = "2026-08-31T00:00:20.100Z";
    earlyReminder.events[1].acknowledgedAt = "2026-08-31T00:00:20.200Z";
    expect(() => verifyMonitoringAlertDrillReport(earlyReminder, new Date("2026-08-31T00:01:00.000Z"))).toThrow("MONITORING_EVIDENCE_REMINDER_DELAY_INVALID");
  });

  it("blocks local smoke, short, stale and differently bound evidence from release", () => {
    const local = structuredClone(report());
    local.target = { ...local.target, targetClass: "local-smoke", transport: "http-loopback-local-smoke" } as MonitoringAlertDrillReport["target"];
    local.environment = "local-smoke";
    local.requestedReminderDelayMs = 10;
    expect(monitoringEvidenceBindingBlockers({
      report: local,
      candidateBuildId: "different-build",
      candidateCreatedAt: "2026-08-31T00:01:00.000Z",
      deploymentManifestSha256: `sha256:${"f".repeat(64)}`,
      releaseCreatedAt: "2026-09-10T00:00:00.000Z",
    })).toEqual([
      "PRODUCTION_RELEASE_MONITORING_CANDIDATE_MISMATCH",
      "PRODUCTION_RELEASE_MONITORING_DEPLOYMENT_MISMATCH",
      "PRODUCTION_RELEASE_MONITORING_PREDATES_CANDIDATE",
      "PRODUCTION_RELEASE_MONITORING_EVIDENCE_STALE",
      "PRODUCTION_RELEASE_MONITORING_TARGET_NOT_PRODUCTION",
      "PRODUCTION_RELEASE_MONITORING_ENVIRONMENT_MISMATCH",
      "PRODUCTION_RELEASE_MONITORING_REMINDER_DRILL_TOO_SHORT",
    ]);
  });
});
