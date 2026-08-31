import { createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deliverOperationalAlert, operationalAlertAcknowledgementSignature, operationalAlertBody,
  operationalAlertBodySha256, operationalAlertDestination, operationalAlertSignature, operationalEventKind,
  type OperationalAlertEnvelope,
} from "./operational-monitor";

function envelope(): OperationalAlertEnvelope {
  return {
    source: "agentgrid",
    environment: "test",
    deliveryId: randomUUID(),
    eventKind: "alert",
    drill: false,
    status: "degraded",
    alerts: ["CHAIN_OUTBOX_STALLED"],
    database: { pendingOutbox: 1 },
    queue: { executorQueued: 0 },
    observedAt: new Date().toISOString(),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("operational alert webhook", () => {
  it("signs the exact validated payload with HMAC-SHA256", () => {
    const secret = "s".repeat(32);
    const body = operationalAlertBody(envelope());
    expect(operationalAlertSignature(secret, body)).toBe(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  });

  it("rejects a weak webhook secret and insecure production destinations", () => {
    expect(() => operationalAlertSignature("short", operationalAlertBody(envelope()))).toThrow("ALERT_WEBHOOK_SECRET_TOO_SHORT");
    expect(() => operationalAlertDestination("http://alerts.example.test/path")).toThrow("ALERT_WEBHOOK_HTTPS_REQUIRED");
    expect(() => operationalAlertDestination("https://user:password@alerts.example.test/path")).toThrow("ALERT_WEBHOOK_URL_CREDENTIALS_OR_FRAGMENT_FORBIDDEN");
    expect(operationalAlertDestination("http://127.0.0.1:9999/path", true).hostname).toBe("127.0.0.1");
    expect(() => operationalAlertDestination("http://192.168.1.2/path", true)).toThrow("ALERT_WEBHOOK_HTTPS_REQUIRED");
  });

  it("distinguishes alert, reminder and recovery transitions", () => {
    expect(operationalEventKind({ alerts: ["A"], fingerprint: "A" })).toBe("alert");
    expect(operationalEventKind({ alerts: ["A"], previousFingerprint: "A", fingerprint: "A" })).toBe("reminder");
    expect(operationalEventKind({ alerts: [], previousFingerprint: "A", fingerprint: "ok" })).toBe("recovery");
  });

  it("requires a receiver acknowledgement bound to delivery, event and exact body", async () => {
    const input = envelope();
    const body = operationalAlertBody(input);
    const bodySha256 = operationalAlertBodySha256(body);
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("x-agentgrid-delivery-id")).toBe(input.deliveryId);
      expect(new Headers(init?.headers).get("x-agentgrid-event")).toBe("operational.alert");
      expect(new Headers(init?.headers).get("x-agentgrid-body-sha256")).toBe(bodySha256);
      const acknowledgement = {
        accepted: true,
        deliveryId: input.deliveryId,
        eventKind: "alert",
        bodySha256,
        signatureVerified: true,
        eventMatched: true,
        receivedAt: new Date().toISOString(),
      } as const;
      return new Response(JSON.stringify({
        ...acknowledgement,
        acknowledgementHmac: operationalAlertAcknowledgementSignature("s".repeat(32), acknowledgement),
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(deliverOperationalAlert("https://alerts.example.test/agentgrid", "s".repeat(32), input)).resolves.toMatchObject({
      bodySha256,
      acknowledgement: { deliveryId: input.deliveryId, eventKind: "alert" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed on unacknowledged, mismatched or oversized responses", async () => {
    const input = envelope();
    const bodySha256 = operationalAlertBodySha256(operationalAlertBody(input));
    const mismatchedAcknowledgement = {
      accepted: true,
      deliveryId: randomUUID(),
      eventKind: "alert",
      bodySha256,
      signatureVerified: true,
      eventMatched: true,
      receivedAt: new Date().toISOString(),
    } as const;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...mismatchedAcknowledgement,
      acknowledgementHmac: operationalAlertAcknowledgementSignature("s".repeat(32), mismatchedAcknowledgement),
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(deliverOperationalAlert("https://alerts.example.test/agentgrid", "s".repeat(32), input)).rejects.toThrow("ALERT_WEBHOOK_ACK_DELIVERY_ID_MISMATCH");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...mismatchedAcknowledgement,
      deliveryId: input.deliveryId,
      acknowledgementHmac: `sha256=${"0".repeat(64)}`,
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(deliverOperationalAlert("https://alerts.example.test/agentgrid", "s".repeat(32), input)).rejects.toThrow("ALERT_WEBHOOK_ACK_HMAC_INVALID");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(16 * 1024 + 1), {
      status: 200, headers: { "content-type": "application/json" },
    })));
    await expect(deliverOperationalAlert("https://alerts.example.test/agentgrid", "s".repeat(32), input)).rejects.toThrow("ALERT_WEBHOOK_ACK_BODY_TOO_LARGE");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(deliverOperationalAlert("https://alerts.example.test/agentgrid", "s".repeat(32), input)).rejects.toThrow("ALERT_WEBHOOK_ACK_CONTENT_TYPE_INVALID");
  });
});
