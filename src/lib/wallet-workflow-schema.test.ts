import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { businessAdoptionReportSchema } from "./business-adoption";
import {
  businessAdoptionStatusResponseSchema,
  businessAdoptionSubmissionResponseSchema,
  notificationReadResponseSchema,
  notificationsResponseSchema,
} from "./wallet-workflow-schema";

const id = "11111111-1111-4111-8111-111111111111";
const address = "0x1111111111111111111111111111111111111111";
const sha256 = `sha256:${"1".repeat(64)}`;
const bytes32 = `0x${"2".repeat(64)}`;

describe("wallet workflow machine contracts", () => {
  it("normalizes bounded notification and business-adoption responses", () => {
    const notifications = notificationsResponseSchema.parse({
      notifications: [{ id, taskId: "42", kind: "TaskCreated", payload: { taskId: "42" }, readAt: null, createdAt: new Date("2026-09-01T00:00:00Z") }],
      unread: 1,
    });
    expect(notifications.notifications[0]?.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(notificationReadResponseSchema.parse({ id, readAt: new Date("2026-09-01T00:01:00Z") }).readAt).toBe("2026-09-01T00:01:00.000Z");

    expect(businessAdoptionStatusResponseSchema.parse({
      chainId: 97,
      release: { id, taskId: "42", publisher: address, artifactHash: sha256, createdAt: new Date("2026-09-01T00:00:00Z") },
    })).toMatchObject({ chainId: 97, release: { taskId: "42" } });
    expect(businessAdoptionSubmissionResponseSchema.parse({ ok: true, reportHash: bytes32 })).toEqual({ ok: true, reportHash: bytes32 });
  });

  it("rejects response drift and unbounded notification payloads", () => {
    const base = { id, taskId: null, kind: "TaskCreated", readAt: null, createdAt: "2026-09-01T00:00:00.000Z" };
    expect(() => notificationsResponseSchema.parse({ notifications: [{ ...base, payload: {}, secret: "drift" }], unread: 1 })).toThrow();
    expect(() => notificationsResponseSchema.parse({ notifications: [{ ...base, payload: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`k${index}`, index])) }], unread: 1 })).toThrow();
    expect(() => notificationsResponseSchema.parse({ notifications: [{ ...base, payload: { value: "x".repeat(70_000) } }], unread: 1 })).toThrow();
    expect(() => notificationsResponseSchema.parse({ notifications: [{ ...base, createdAt: "not-a-date", payload: {} }], unread: 1 })).toThrow();
  });

  it("binds all four production routes and the signed report fields to OpenAPI", () => {
    const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8")) as {
      info: { version: string };
      paths: Record<string, Record<string, { operationId: string; security?: Array<Record<string, unknown>>; requestBody?: { content: { "application/json": { schema: { $ref: string } } } }; responses: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> }>>;
      components: { schemas: Record<string, { additionalProperties?: boolean; required?: string[]; properties?: Record<string, unknown>; oneOf?: Array<{ additionalProperties?: boolean }> }> };
    };
    expect(openapi.info.version).toBe("0.7.0");
    const operations = [
      ["/api/notifications", "get", "listWalletNotifications", "200"],
      ["/api/notifications/{notificationId}/read", "post", "markWalletNotificationRead", "200"],
      ["/api/tasks/{taskId}/business-adoption", "get", "getBusinessAdoption", "200"],
      ["/api/tasks/{taskId}/business-adoption", "post", "submitBusinessAdoption", "201"],
    ] as const;
    for (const [path, method, operationId, status] of operations) {
      const operation = openapi.paths[path]?.[method];
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.security).toEqual([{ WalletSession: [] }]);
      const reference = operation?.responses[status]?.content?.["application/json"]?.schema?.$ref;
      expect(reference).toMatch(/^#\/components\/schemas\//);
    }
    const submissionReference = openapi.paths["/api/tasks/{taskId}/business-adoption"]?.post?.requestBody?.content["application/json"].schema.$ref;
    expect(submissionReference).toBe("#/components/schemas/BusinessAdoptionSubmission");
    const report = openapi.components.schemas.BusinessAdoptionReport;
    expect(new Set(report.required)).toEqual(new Set(businessAdoptionReportSchema.keyof().options));
    expect(report.additionalProperties).toBe(false);
    expect(openapi.components.schemas.BusinessAdoptionStatus.oneOf?.every((variant) => variant.additionalProperties === false)).toBe(true);
  });
});
