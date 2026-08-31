import { z } from "zod";
import { operationalAlertAcknowledgementSchema, operationalAlertEventKinds } from "./operational-monitor";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/).refine((value) => !/^sha256:0{64}$/.test(value));
const eventBaseSchema = z.object({
  deliveryId: z.string().uuid(),
  eventKind: z.enum(operationalAlertEventKinds),
  status: z.enum(["ok", "degraded"]),
  alerts: z.array(z.string()).max(32),
  sentAt: z.string().datetime({ offset: true }),
  acknowledgedAt: z.string().datetime({ offset: true }),
  latencyMs: z.number().int().min(0).max(10_000),
  bodySha256: sha256Schema,
  acknowledgement: operationalAlertAcknowledgementSchema,
}).strict();

const alertEventSchema = eventBaseSchema.extend({
  eventKind: z.literal("alert"),
  status: z.literal("degraded"),
  alerts: z.tuple([z.literal("MONITORING_ALERT_DRILL")]),
}).strict();
const reminderEventSchema = eventBaseSchema.extend({
  eventKind: z.literal("reminder"),
  status: z.literal("degraded"),
  alerts: z.tuple([z.literal("MONITORING_ALERT_DRILL")]),
}).strict();
const recoveryEventSchema = eventBaseSchema.extend({
  eventKind: z.literal("recovery"),
  status: z.literal("ok"),
  alerts: z.tuple([]),
}).strict();

const productionTargetSchema = z.object({
  targetClass: z.literal("production-https"),
  transport: z.literal("https"),
  receiverProvider: z.string().min(2).max(96),
  receiverUrlHash: sha256Schema,
  acknowledgementRequired: z.literal(true),
  hmacSha256: z.literal(true),
  redirectsRejected: z.literal(true),
  timeoutMs: z.literal(10_000),
}).strict();
const localTargetSchema = productionTargetSchema.extend({
  targetClass: z.literal("local-smoke"),
  transport: z.enum(["https", "http-loopback-local-smoke"]),
}).strict();

export const monitoringAlertDrillReportSchema = z.object({
  version: z.literal(1),
  scope: z.literal("agentgrid-monitoring-alert-drill"),
  chainId: z.literal(97),
  candidateBuildId: z.string().min(8).max(128),
  deploymentManifestSha256: sha256Schema,
  startedAt: z.string().datetime({ offset: true }),
  observedAt: z.string().datetime({ offset: true }),
  environment: z.string().min(1).max(64),
  requestedReminderDelayMs: z.number().int().min(0).max(900_000),
  target: z.discriminatedUnion("targetClass", [productionTargetSchema, localTargetSchema]),
  events: z.tuple([alertEventSchema, reminderEventSchema, recoveryEventSchema]),
}).strict();

export type MonitoringAlertDrillReport = z.infer<typeof monitoringAlertDrillReportSchema>;

export function verifyMonitoringAlertDrillReport(raw: unknown, now = new Date()) {
  const report = monitoringAlertDrillReportSchema.parse(raw);
  const startedAt = new Date(report.startedAt).getTime();
  const observedAt = new Date(report.observedAt).getTime();
  if (observedAt < startedAt || observedAt > now.getTime() + 5 * 60_000) throw new Error("MONITORING_EVIDENCE_TIME_INVALID");
  const deliveryIds = new Set<string>();
  const bodyHashes = new Set<string>();
  for (const event of report.events) {
    const sentAt = new Date(event.sentAt).getTime();
    const acknowledgedAt = new Date(event.acknowledgedAt).getTime();
    if (sentAt < startedAt || acknowledgedAt < sentAt || acknowledgedAt > observedAt) throw new Error("MONITORING_EVIDENCE_EVENT_TIME_INVALID");
    if (acknowledgedAt - sentAt !== event.latencyMs) throw new Error("MONITORING_EVIDENCE_LATENCY_INVALID");
    if (deliveryIds.has(event.deliveryId)) throw new Error("MONITORING_EVIDENCE_DELIVERY_ID_REUSED");
    deliveryIds.add(event.deliveryId);
    if (bodyHashes.has(event.bodySha256)) throw new Error("MONITORING_EVIDENCE_BODY_SHA256_REUSED");
    bodyHashes.add(event.bodySha256);
    if (event.acknowledgement.deliveryId !== event.deliveryId
      || event.acknowledgement.eventKind !== event.eventKind
      || event.acknowledgement.bodySha256 !== event.bodySha256) {
      throw new Error("MONITORING_EVIDENCE_ACKNOWLEDGEMENT_MISMATCH");
    }
    const receiverAt = new Date(event.acknowledgement.receivedAt).getTime();
    if (receiverAt < sentAt - 5 * 60_000 || receiverAt > acknowledgedAt + 5 * 60_000) {
      throw new Error("MONITORING_EVIDENCE_RECEIVER_TIME_INVALID");
    }
  }
  const [alert, reminder, recovery] = report.events;
  if (new Date(reminder.sentAt).getTime() - new Date(alert.acknowledgedAt).getTime() < report.requestedReminderDelayMs) {
    throw new Error("MONITORING_EVIDENCE_REMINDER_DELAY_INVALID");
  }
  if (new Date(recovery.sentAt).getTime() < new Date(reminder.acknowledgedAt).getTime()) {
    throw new Error("MONITORING_EVIDENCE_EVENT_ORDER_INVALID");
  }
  return report;
}

export function monitoringEvidenceBindingBlockers(input: {
  report: MonitoringAlertDrillReport;
  candidateBuildId: string;
  candidateCreatedAt: string;
  deploymentManifestSha256: string;
  releaseCreatedAt: string;
}) {
  const blockers: string[] = [];
  if (input.report.candidateBuildId !== input.candidateBuildId) blockers.push("PRODUCTION_RELEASE_MONITORING_CANDIDATE_MISMATCH");
  if (input.report.deploymentManifestSha256 !== input.deploymentManifestSha256) blockers.push("PRODUCTION_RELEASE_MONITORING_DEPLOYMENT_MISMATCH");
  const releaseAt = new Date(input.releaseCreatedAt).getTime();
  const observedAt = new Date(input.report.observedAt).getTime();
  if (new Date(input.report.startedAt).getTime() < new Date(input.candidateCreatedAt).getTime()) {
    blockers.push("PRODUCTION_RELEASE_MONITORING_PREDATES_CANDIDATE");
  }
  if (observedAt > releaseAt) blockers.push("PRODUCTION_RELEASE_PREDATES_MONITORING_EVIDENCE");
  if (releaseAt - observedAt > 7 * 24 * 60 * 60_000) blockers.push("PRODUCTION_RELEASE_MONITORING_EVIDENCE_STALE");
  if (input.report.target.targetClass !== "production-https" || input.report.target.transport !== "https") {
    blockers.push("PRODUCTION_RELEASE_MONITORING_TARGET_NOT_PRODUCTION");
  }
  if (input.report.environment !== "production") blockers.push("PRODUCTION_RELEASE_MONITORING_ENVIRONMENT_MISMATCH");
  if (input.report.requestedReminderDelayMs < 30_000) blockers.push("PRODUCTION_RELEASE_MONITORING_REMINDER_DRILL_TOO_SHORT");
  return [...new Set(blockers)];
}
