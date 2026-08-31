import { requiredConfigValue, requiredSecret } from "../src/lib/secrets";
import { runMonitoringAlertDrill } from "./monitoring-alert-drill";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function main() {
  const targetClass = required("MONITORING_ALERT_TARGET_CLASS");
  if (targetClass !== "production-https" && targetClass !== "local-smoke") throw new Error("MONITORING_ALERT_TARGET_CLASS_INVALID");
  const localSmoke = process.env.MONITORING_ALERT_LOCAL_SMOKE === "true";
  if (targetClass === "local-smoke" && !localSmoke) throw new Error("MONITORING_ALERT_DRILL_LOCAL_SMOKE_FLAG_REQUIRED");
  if (targetClass === "production-https" && localSmoke) throw new Error("MONITORING_ALERT_DRILL_PRODUCTION_INSECURE_OVERRIDE_FORBIDDEN");
  const requestedReminderDelayMs = Number(process.env.MONITORING_ALERT_DRILL_REMINDER_DELAY_MS ?? (localSmoke ? 10 : 30_000));
  const result = await runMonitoringAlertDrill({
    webhookUrl: requiredConfigValue("ALERT_WEBHOOK_URL"),
    webhookSecret: requiredSecret("ALERT_WEBHOOK_SECRET"),
    targetClass,
    receiverProvider: required("MONITORING_ALERT_RECEIVER_PROVIDER"),
    environment: process.env.DEPLOYMENT_ENVIRONMENT?.trim() || "production",
    candidateBuildId: required("MONITORING_EVIDENCE_CANDIDATE_BUILD_ID"),
    deploymentManifestSha256: required("MONITORING_EVIDENCE_DEPLOYMENT_MANIFEST_SHA256"),
    requestedReminderDelayMs,
    reportFile: required("MONITORING_ALERT_DRILL_REPORT_FILE"),
    allowInsecureLocalSmoke: localSmoke,
  });
  console.log(JSON.stringify({
    monitoringAlertDrillVerified: true,
    targetClass: result.report.target.targetClass,
    events: result.report.events.length,
    output: result.output,
  }));
}

void main().catch((error) => {
  console.error(error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message)
    ? error.message : "MONITORING_ALERT_DRILL_FAILED");
  process.exitCode = 1;
});
