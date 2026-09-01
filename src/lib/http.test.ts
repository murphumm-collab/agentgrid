import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiError } from "./http";

const previousProtocolMode = process.env.PROTOCOL_MODE;

afterEach(() => {
  if (previousProtocolMode === undefined) delete process.env.PROTOCOL_MODE;
  else process.env.PROTOCOL_MODE = previousProtocolMode;
});

describe("API error responses", () => {
  it("never permits an intermediary to cache authentication or validation failures", async () => {
    process.env.PROTOCOL_MODE = "demo";
    const response = apiError(new Error("AUTHENTICATION_REQUIRED"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(await response.json()).toEqual({ error: "AUTHENTICATION_REQUIRED" });
  });

  it.each([
    "AUTH_CHALLENGE_INVALID_OR_EXPIRED",
    "AUTH_MESSAGE_MISMATCH",
    "AUTH_SIGNATURE_INVALID",
  ])("maps wallet credential failure to 401: %s", async (error) => {
    process.env.PROTOCOL_MODE = "demo";
    const response = apiError(new Error(error));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error });
  });

  it("keeps invalid request origin at 403", async () => {
    process.env.PROTOCOL_MODE = "demo";
    const response = apiError(new Error("INVALID_REQUEST_ORIGIN"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_REQUEST_ORIGIN" });
  });

  it.each([
    ["BINARY_BODY_REQUIRED", 400],
    ["CONTENT_LENGTH_INVALID", 400],
    ["BINARY_CONTENT_LENGTH_MISMATCH", 409],
    ["REQUEST_BODY_TOO_LARGE", 413],
    ["BINARY_CONTENT_TYPE_REQUIRED", 415],
  ] as const)("maps binary body failure %s to %i", async (error, status) => {
    const response = apiError(new Error(error));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
  });

  it("returns a stable closed validation envelope instead of a dynamic Zod message", async () => {
    const parsed = z.object({ count: z.number().int().positive() }).strict().safeParse({ count: "secret", injected: true });
    if (parsed.success) throw new Error("TEST_SETUP_INVALID");
    const response = apiError(parsed.error);
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string; issues: Array<Record<string, unknown>> };
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.issues.length).toBeGreaterThan(0);
    for (const issue of body.issues) expect(Object.keys(issue).sort()).toEqual(["code", "message", "path"]);
    expect(JSON.stringify(body)).not.toContain('"count": "secret"');
  });

  it("fails closed on unclassified internal messages in every mode", async () => {
    process.env.PROTOCOL_MODE = "demo";
    for (const error of [new Error("database password was rejected"), new Error("A".repeat(121)), { thrown: true }]) {
      const response = apiError(error);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: "INTERNAL_ERROR" });
    }
  });
});
