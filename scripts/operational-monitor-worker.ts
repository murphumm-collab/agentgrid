import { randomUUID } from "node:crypto";
import { closeRedisForTests, operationalQueueMetrics } from "../src/lib/agent-queue";
import { runtimeConfig } from "../src/lib/env";
import { operationalAlerts } from "../src/lib/operational-alerts";
import { deliverOperationalAlert, operationalEventKind, type OperationalAlertEnvelope } from "../src/lib/operational-monitor";
import { closePostgresForTests, operationalDatabaseMetrics } from "../src/lib/store-postgres";
import { requiredConfigValue, requiredSecret } from "../src/lib/secrets";

function required(name: string) {
  return name === "ALERT_WEBHOOK_SECRET" ? requiredSecret(name) : requiredConfigValue(name);
}

const intervalSeconds = Number(process.env.OPS_MONITOR_INTERVAL_SECONDS ?? 60);
const reminderSeconds = Number(process.env.OPS_MONITOR_REMINDER_SECONDS ?? 900);
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 30 || intervalSeconds > 3_600) throw new Error("OPS_MONITOR_INTERVAL_SECONDS_INVALID");
if (!Number.isInteger(reminderSeconds) || reminderSeconds < intervalSeconds || reminderSeconds > 86_400) throw new Error("OPS_MONITOR_REMINDER_SECONDS_INVALID");
const webhookUrl = required("ALERT_WEBHOOK_URL");
const webhookSecret = required("ALERT_WEBHOOK_SECRET");
const environment = process.env.DEPLOYMENT_ENVIRONMENT ?? "production";
let stopping = false;
let previousFingerprint: string | undefined;
let lastSentAt = 0;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function poll() {
  runtimeConfig();
  const [database, queue] = await Promise.all([operationalDatabaseMetrics(), operationalQueueMetrics()]);
  const alerts = operationalAlerts(database, queue);
  const fingerprint = alerts.join("|") || "ok";
  const now = Date.now();
  if (fingerprint === previousFingerprint && now - lastSentAt < reminderSeconds * 1_000) return;
  const envelope: OperationalAlertEnvelope = {
    source: "agentgrid",
    environment,
    deliveryId: randomUUID(),
    eventKind: operationalEventKind({ alerts, previousFingerprint, fingerprint }),
    drill: false,
    status: alerts.length ? "degraded" : "ok",
    alerts,
    database,
    queue,
    observedAt: new Date(now).toISOString(),
  };
  const delivery = await deliverOperationalAlert(webhookUrl, webhookSecret, envelope);
  previousFingerprint = fingerprint;
  lastSentAt = now;
  console.log(JSON.stringify({
    status: envelope.status,
    eventKind: envelope.eventKind,
    alerts,
    delivered: true,
    deliveryId: envelope.deliveryId,
    acknowledgedAt: delivery.acknowledgement.receivedAt,
    observedAt: envelope.observedAt,
  }));
}

async function main() {
  while (!stopping) {
    try { await poll(); }
    catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), observedAt: new Date().toISOString() })); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1_000));
  }
  await Promise.all([closeRedisForTests(), closePostgresForTests()]);
}

void main();
