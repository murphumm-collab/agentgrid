import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  assertSameOrigin: vi.fn(),
  verifyWalletChallenge: vi.fn(),
}));
const security = vi.hoisted(() => ({
  audit: vi.fn(),
  enforceRateLimit: vi.fn(),
  requestClientKey: vi.fn(() => "trusted-client"),
  requestId: vi.fn(() => "request-1"),
}));

vi.mock("@/lib/auth", () => ({
  ...auth,
  SESSION_COOKIE: "agentgrid-session",
}));
vi.mock("@/lib/security", () => security);
vi.mock("@/lib/env", () => ({
  runtimeConfig: () => ({ PROTOCOL_MODE: "production", SESSION_TTL_SECONDS: 3600 }),
}));

import { POST } from "./route";

const body = {
  address: `0x${"1".repeat(40)}`,
  nonce: "00".repeat(16),
  message: "signed challenge",
  signature: `0x${"00".repeat(65)}`,
};

function request() {
  return new Request("https://grid.example/api/auth/verify", {
    method: "POST",
    headers: { origin: "https://grid.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function requestWith(payload: unknown, origin = "https://grid.example") {
  return new Request("https://grid.example/api/auth/verify", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("wallet verification abuse boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    security.requestClientKey.mockReturnValue("trusted-client");
    security.enforceRateLimit.mockResolvedValue(undefined);
    auth.verifyWalletChallenge.mockResolvedValue({ address: body.address, chainId: 97, token: "signed-session" });
  });

  it("limits the trusted client before verifying a wallet signature", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(security.enforceRateLimit).toHaveBeenCalledWith("auth-verify:trusted-client", 20, 60);
    expect(auth.verifyWalletChallenge).toHaveBeenCalledWith(body);
    expect(response.headers.get("set-cookie")).toContain("agentgrid-session=signed-session");
  });

  it("returns the documented 429 without parsing or verifying another challenge", async () => {
    security.enforceRateLimit.mockRejectedValue(new Error("RATE_LIMIT_EXCEEDED"));
    const response = await POST(request());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "RATE_LIMIT_EXCEEDED" });
    expect(auth.verifyWalletChallenge).not.toHaveBeenCalled();

    const openapi = JSON.parse(readFileSync(new URL("../../../../../public/openapi.json", import.meta.url), "utf8")) as {
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    expect(openapi.paths["/api/auth/verify"].post?.responses?.["429"]).toBeTruthy();
  });

  it("rejects malformed or extended challenge responses before authentication logic", async () => {
    const malformed = await POST(requestWith({ ...body, nonce: 42 }));
    expect(malformed.status).toBe(400);
    expect(auth.verifyWalletChallenge).not.toHaveBeenCalled();

    const extended = await POST(requestWith({ ...body, unexpected: true }));
    expect(extended.status).toBe(400);
    expect(auth.verifyWalletChallenge).not.toHaveBeenCalled();
  });

  it.each([
    "AUTH_CHALLENGE_INVALID_OR_EXPIRED",
    "AUTH_MESSAGE_MISMATCH",
    "AUTH_SIGNATURE_INVALID",
  ])("maps invalid wallet credentials to documented 401: %s", async (error) => {
    auth.verifyWalletChallenge.mockRejectedValue(new Error(error));
    const response = await POST(request());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error });
  });

  it("keeps an invalid browser origin distinct as 403", async () => {
    auth.assertSameOrigin.mockImplementation(() => { throw new Error("INVALID_REQUEST_ORIGIN"); });
    const response = await POST(requestWith(body, "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(security.enforceRateLimit).not.toHaveBeenCalled();
    expect(auth.verifyWalletChallenge).not.toHaveBeenCalled();
  });

  it("binds the runtime status surface to OpenAPI 0.8.4", () => {
    const openapi = JSON.parse(readFileSync(new URL("../../../../../public/openapi.json", import.meta.url), "utf8")) as {
      info: { version: string };
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    expect(openapi.info.version).toBe("0.8.4");
    expect(Object.keys(openapi.paths["/api/auth/verify"].post?.responses ?? {}).sort()).toEqual([
      "200", "400", "401", "403", "413", "415", "429", "500",
    ]);
  });
});
