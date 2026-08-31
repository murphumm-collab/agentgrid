import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  operationalAlertAcknowledgementSignature, operationalAlertBodySha256, operationalAlertEnvelopeSchema,
  operationalAlertSignature,
} from "../src/lib/operational-monitor";
import { verifyMonitoringAlertDrillReport } from "../src/lib/monitoring-evidence";
import { runMonitoringAlertDrill } from "./monitoring-alert-drill";

async function main() {
  const secret = randomBytes(48).toString("hex");
  const received: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) request.destroy();
      else chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        const envelope = operationalAlertEnvelopeSchema.parse(JSON.parse(body));
        const expectedSignature = Buffer.from(operationalAlertSignature(secret, body));
        const providedSignature = Buffer.from(String(request.headers["x-agentgrid-signature"] ?? ""));
        if (expectedSignature.length !== providedSignature.length || !timingSafeEqual(expectedSignature, providedSignature)) throw new Error("SIGNATURE_INVALID");
        const bodySha256 = operationalAlertBodySha256(body);
        if (request.headers["x-agentgrid-body-sha256"] !== bodySha256
          || request.headers["x-agentgrid-delivery-id"] !== envelope.deliveryId
          || request.headers["x-agentgrid-event"] !== `operational.${envelope.eventKind}`) throw new Error("HEADERS_INVALID");
        received.push(envelope.eventKind);
        const acknowledgement = {
          accepted: true,
          deliveryId: envelope.deliveryId,
          eventKind: envelope.eventKind,
          bodySha256,
          signatureVerified: true,
          eventMatched: true,
          receivedAt: new Date().toISOString(),
        } as const;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          ...acknowledgement,
          acknowledgementHmac: operationalAlertAcknowledgementSignature(secret, acknowledgement),
        }));
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ accepted: false }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("MONITORING_SMOKE_SERVER_ADDRESS_INVALID");
  const folder = await fs.mkdtemp(path.join(tmpdir(), "agentgrid-monitoring-smoke-"));
  const reportFile = process.env.MONITORING_ALERT_DRILL_SMOKE_REPORT_FILE?.trim()
    ? path.resolve(process.env.MONITORING_ALERT_DRILL_SMOKE_REPORT_FILE)
    : path.join(folder, "monitoring-alert-drill.json");
  try {
    const result = await runMonitoringAlertDrill({
      webhookUrl: `http://127.0.0.1:${address.port}/agentgrid`,
      webhookSecret: secret,
      targetClass: "local-smoke",
      receiverProvider: "agentgrid-local-loopback-smoke",
      environment: "local-smoke",
      candidateBuildId: process.env.MONITORING_EVIDENCE_CANDIDATE_BUILD_ID?.trim() || "local-smoke-build",
      deploymentManifestSha256: process.env.MONITORING_EVIDENCE_DEPLOYMENT_MANIFEST_SHA256?.trim()
        || `sha256:${createHash("sha256").update("local-smoke-deployment").digest("hex")}`,
      requestedReminderDelayMs: 10,
      reportFile,
      allowInsecureLocalSmoke: true,
    });
    const report = verifyMonitoringAlertDrillReport(JSON.parse(await fs.readFile(reportFile, "utf8")));
    const stat = await fs.stat(reportFile);
    if ((stat.mode & 0o077) !== 0) throw new Error("MONITORING_SMOKE_REPORT_PERMISSIONS_INVALID");
    if (received.join(",") !== "alert,reminder,recovery") throw new Error("MONITORING_SMOKE_EVENT_SEQUENCE_INVALID");
    if (report.events.some((event) => !event.acknowledgement.signatureVerified)) throw new Error("MONITORING_SMOKE_ACK_INVALID");
    console.log(JSON.stringify({
      monitoringAlertDrillSmoke: true,
      events: received,
      acknowledgements: result.report.events.length,
      reportMode: (stat.mode & 0o777).toString(8),
      productionEligible: false,
      output: process.env.MONITORING_ALERT_DRILL_SMOKE_REPORT_FILE ? reportFile : null,
    }));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(folder, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "MONITORING_ALERT_DRILL_SMOKE_FAILED");
  process.exitCode = 1;
});
