import { createHash, randomUUID } from "node:crypto";
import {
  deliverOperationalAlert, type OperationalAlertEnvelope, type OperationalAlertEventKind,
} from "../src/lib/operational-monitor";
import { monitoringAlertDrillReportSchema, type MonitoringAlertDrillReport } from "../src/lib/monitoring-evidence";
import { writeNewEvidenceFile } from "../src/lib/evidence-file";

export interface MonitoringAlertDrillConfiguration {
  webhookUrl: string;
  webhookSecret: string;
  targetClass: "production-https" | "local-smoke";
  receiverProvider: string;
  environment: string;
  candidateBuildId: string;
  deploymentManifestSha256: string;
  requestedReminderDelayMs: number;
  reportFile: string;
  allowInsecureLocalSmoke?: boolean;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runMonitoringAlertDrill(configuration: MonitoringAlertDrillConfiguration) {
  if (!Number.isInteger(configuration.requestedReminderDelayMs)
    || configuration.requestedReminderDelayMs < 0 || configuration.requestedReminderDelayMs > 900_000) {
    throw new Error("MONITORING_ALERT_DRILL_REMINDER_DELAY_INVALID");
  }
  if (configuration.targetClass === "production-https" && configuration.allowInsecureLocalSmoke) {
    throw new Error("MONITORING_ALERT_DRILL_PRODUCTION_INSECURE_OVERRIDE_FORBIDDEN");
  }
  if (configuration.targetClass === "local-smoke" && !configuration.allowInsecureLocalSmoke) {
    throw new Error("MONITORING_ALERT_DRILL_LOCAL_SMOKE_FLAG_REQUIRED");
  }
  const startedAt = new Date().toISOString();
  const events: MonitoringAlertDrillReport["events"][number][] = [];

  const send = async (eventKind: OperationalAlertEventKind) => {
    const sentAt = new Date().toISOString();
    const degraded = eventKind !== "recovery";
    const envelope: OperationalAlertEnvelope = {
      source: "agentgrid",
      environment: configuration.environment,
      deliveryId: randomUUID(),
      eventKind,
      drill: true,
      status: degraded ? "degraded" : "ok",
      alerts: degraded ? ["MONITORING_ALERT_DRILL"] : [],
      database: degraded ? { chainCursorAgeSeconds: 121 } : { chainCursorAgeSeconds: 0 },
      queue: { executorQueued: 0, testerQueued: 0, evaluatorQueued: 0, coordinatorQueued: 0 },
      observedAt: sentAt,
    };
    const delivery = await deliverOperationalAlert(
      configuration.webhookUrl,
      configuration.webhookSecret,
      envelope,
      { allowInsecureLocalSmoke: configuration.allowInsecureLocalSmoke },
    );
    const acknowledgedAt = new Date().toISOString();
    events.push({
      deliveryId: envelope.deliveryId,
      eventKind,
      status: envelope.status,
      alerts: envelope.alerts,
      sentAt,
      acknowledgedAt,
      latencyMs: new Date(acknowledgedAt).getTime() - new Date(sentAt).getTime(),
      bodySha256: delivery.bodySha256,
      acknowledgement: delivery.acknowledgement,
    } as MonitoringAlertDrillReport["events"][number]);
  };

  await send("alert");
  await sleep(configuration.requestedReminderDelayMs);
  await send("reminder");
  await send("recovery");
  const destination = new URL(configuration.webhookUrl);
  const report = monitoringAlertDrillReportSchema.parse({
    version: 1,
    scope: "agentgrid-monitoring-alert-drill",
    chainId: 97,
    candidateBuildId: configuration.candidateBuildId,
    deploymentManifestSha256: configuration.deploymentManifestSha256,
    startedAt,
    observedAt: new Date().toISOString(),
    environment: configuration.environment,
    requestedReminderDelayMs: configuration.requestedReminderDelayMs,
    target: {
      targetClass: configuration.targetClass,
      transport: destination.protocol === "https:" ? "https" : "http-loopback-local-smoke",
      receiverProvider: configuration.receiverProvider,
      receiverUrlHash: sha256(destination.toString()),
      acknowledgementRequired: true,
      hmacSha256: true,
      redirectsRejected: true,
      timeoutMs: 10_000,
    },
    events,
  });
  const output = await writeNewEvidenceFile(configuration.reportFile, report, "MONITORING_EVIDENCE");
  return { report, output };
}
