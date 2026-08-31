import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const operationalAlertEventKinds = ["alert", "reminder", "recovery"] as const;
export type OperationalAlertEventKind = typeof operationalAlertEventKinds[number];

const metricValueSchema = z.number().finite().nullable();
export const operationalAlertEnvelopeSchema = z.object({
  source: z.literal("agentgrid"),
  environment: z.string().min(1).max(64),
  deliveryId: z.string().uuid(),
  eventKind: z.enum(operationalAlertEventKinds),
  drill: z.boolean(),
  status: z.enum(["ok", "degraded"]),
  alerts: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,95}$/)).max(32),
  database: z.record(z.string(), metricValueSchema),
  queue: z.record(z.string(), z.number().finite()),
  observedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if ((value.eventKind === "recovery") !== (value.status === "ok")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "OPERATIONAL_ALERT_EVENT_STATUS_MISMATCH" });
  }
  if ((value.status === "ok") !== (value.alerts.length === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "OPERATIONAL_ALERT_STATUS_ALERTS_MISMATCH" });
  }
});

export const operationalAlertAcknowledgementUnsignedSchema = z.object({
  accepted: z.literal(true),
  deliveryId: z.string().uuid(),
  eventKind: z.enum(operationalAlertEventKinds),
  bodySha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  signatureVerified: z.literal(true),
  eventMatched: z.literal(true),
  receivedAt: z.string().datetime({ offset: true }),
}).strict();
export const operationalAlertAcknowledgementSchema = operationalAlertAcknowledgementUnsignedSchema.extend({
  acknowledgementHmac: z.string().regex(/^sha256=[0-9a-f]{64}$/),
}).strict();

export type OperationalAlertEnvelope = z.infer<typeof operationalAlertEnvelopeSchema>;
export type OperationalAlertAcknowledgementUnsigned = z.infer<typeof operationalAlertAcknowledgementUnsignedSchema>;
export type OperationalAlertAcknowledgement = z.infer<typeof operationalAlertAcknowledgementSchema>;

export function operationalAlertBody(envelope: OperationalAlertEnvelope) {
  return JSON.stringify(operationalAlertEnvelopeSchema.parse(envelope));
}

export function operationalAlertBodySha256(body: string) {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

export function operationalAlertSignature(secret: string, body: string) {
  if (Buffer.byteLength(secret) < 32) throw new Error("ALERT_WEBHOOK_SECRET_TOO_SHORT");
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function operationalAlertAcknowledgementSignature(
  secret: string,
  acknowledgement: OperationalAlertAcknowledgementUnsigned,
) {
  if (Buffer.byteLength(secret) < 32) throw new Error("ALERT_WEBHOOK_SECRET_TOO_SHORT");
  const canonical = JSON.stringify(operationalAlertAcknowledgementUnsignedSchema.parse(acknowledgement));
  return `sha256=${createHmac("sha256", secret).update(`agentgrid-alert-ack-v1\n${canonical}`).digest("hex")}`;
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function operationalEventKind(input: {
  alerts: string[];
  previousFingerprint?: string;
  fingerprint: string;
}): OperationalAlertEventKind {
  if (input.alerts.length === 0) return "recovery";
  return input.previousFingerprint === input.fingerprint ? "reminder" : "alert";
}

function isLoopback(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function operationalAlertDestination(url: string, allowInsecureLocalSmoke = false) {
  const destination = new URL(url);
  if (destination.username || destination.password || destination.hash) throw new Error("ALERT_WEBHOOK_URL_CREDENTIALS_OR_FRAGMENT_FORBIDDEN");
  if (destination.protocol === "https:") return destination;
  if (allowInsecureLocalSmoke && destination.protocol === "http:" && isLoopback(destination.hostname)) return destination;
  throw new Error("ALERT_WEBHOOK_HTTPS_REQUIRED");
}

async function boundedAcknowledgement(response: Response, maximum = 16 * 1024) {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("ALERT_WEBHOOK_ACK_CONTENT_TYPE_INVALID");
  }
  if (!response.body) throw new Error("ALERT_WEBHOOK_ACK_BODY_MISSING");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximum) throw new Error("ALERT_WEBHOOK_ACK_BODY_TOO_LARGE");
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes < 1) throw new Error("ALERT_WEBHOOK_ACK_BODY_MISSING");
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  try {
    return operationalAlertAcknowledgementSchema.parse(JSON.parse(body));
  } catch {
    throw new Error("ALERT_WEBHOOK_ACK_INVALID");
  }
}

export async function deliverOperationalAlert(
  url: string,
  secret: string,
  envelopeInput: OperationalAlertEnvelope,
  options: { allowInsecureLocalSmoke?: boolean } = {},
) {
  const envelope = operationalAlertEnvelopeSchema.parse(envelopeInput);
  const destination = operationalAlertDestination(url, options.allowInsecureLocalSmoke === true);
  const body = operationalAlertBody(envelope);
  const bodySha256 = operationalAlertBodySha256(body);
  const response = await fetch(destination, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agentgrid-signature": operationalAlertSignature(secret, body),
      "x-agentgrid-event": `operational.${envelope.eventKind}`,
      "x-agentgrid-delivery-id": envelope.deliveryId,
      "x-agentgrid-body-sha256": bodySha256,
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ALERT_WEBHOOK_FAILED_${response.status}`);
  const acknowledgement = await boundedAcknowledgement(response);
  const { acknowledgementHmac, ...unsignedAcknowledgement } = acknowledgement;
  const expectedAcknowledgementHmac = operationalAlertAcknowledgementSignature(secret, unsignedAcknowledgement);
  if (!timingSafeStringEqual(acknowledgementHmac, expectedAcknowledgementHmac)) throw new Error("ALERT_WEBHOOK_ACK_HMAC_INVALID");
  if (acknowledgement.deliveryId !== envelope.deliveryId) throw new Error("ALERT_WEBHOOK_ACK_DELIVERY_ID_MISMATCH");
  if (acknowledgement.eventKind !== envelope.eventKind) throw new Error("ALERT_WEBHOOK_ACK_EVENT_MISMATCH");
  if (acknowledgement.bodySha256 !== bodySha256) throw new Error("ALERT_WEBHOOK_ACK_BODY_SHA256_MISMATCH");
  const receiverTime = new Date(acknowledgement.receivedAt).getTime();
  const observedTime = new Date(envelope.observedAt).getTime();
  if (receiverTime < observedTime - 5 * 60_000 || receiverTime > Date.now() + 5 * 60_000) {
    throw new Error("ALERT_WEBHOOK_ACK_TIME_INVALID");
  }
  return { acknowledgement, bodySha256 };
}
