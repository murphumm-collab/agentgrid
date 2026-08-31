import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resetRuntimeConfigForTests, runtimeConfig } from "./env";
import { requestClientKey } from "./security";

const previous = { ...process.env };

function productionProxyEnvironment() {
  process.env.PROTOCOL_MODE = "production";
  process.env.DATABASE_URL = "postgresql://agentgrid:secret@127.0.0.1:5432/agentgrid";
  process.env.AUTH_SECRET = "production-auth-secret-at-least-thirty-two-characters";
  process.env.TRUST_PROXY = "true";
  process.env.TRUSTED_PROXY_SHARED_SECRET = "production-proxy-secret-at-least-thirty-two-characters";
  resetRuntimeConfigForTests();
}

afterEach(() => {
  process.env = { ...previous };
  resetRuntimeConfigForTests();
});

describe("trusted proxy client identity", () => {
  it("ignores spoofed forwarding headers when proxy trust is disabled", () => {
    process.env.PROTOCOL_MODE = "demo";
    process.env.TRUST_PROXY = "false";
    resetRuntimeConfigForTests();
    const request = new Request("http://localhost", { headers: { "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.10" } });
    expect(requestClientKey(request)).toBe(createHash("sha256").update("untrusted-direct").digest("hex"));
  });

  it("accepts only an authenticated proxy and one canonical IP", () => {
    productionProxyEnvironment();
    const secret = process.env.TRUSTED_PROXY_SHARED_SECRET!;
    const request = new Request("https://agentgrid.example", { headers: {
      "x-agentgrid-proxy-auth": secret,
      "x-forwarded-for": "203.0.113.9",
    } });
    expect(requestClientKey(request)).toBe(createHash("sha256").update("203.0.113.9").digest("hex"));
    const ipv6 = new Request("https://agentgrid.example", { headers: {
      "x-agentgrid-proxy-auth": secret,
      "x-forwarded-for": "2001:db8::9",
    } });
    expect(requestClientKey(ipv6)).toBe(createHash("sha256").update("2001:db8::9").digest("hex"));
  });

  it("fails closed for a missing/wrong proxy credential or an appended chain", () => {
    productionProxyEnvironment();
    expect(() => requestClientKey(new Request("https://agentgrid.example", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    }))).toThrow("TRUSTED_PROXY_AUTHENTICATION_REQUIRED");
    expect(() => requestClientKey(new Request("https://agentgrid.example", { headers: {
      "x-agentgrid-proxy-auth": "wrong-proxy-secret-at-least-thirty-two-characters",
      "x-forwarded-for": "203.0.113.9",
    } }))).toThrow("TRUSTED_PROXY_AUTHENTICATION_REQUIRED");
    expect(() => requestClientKey(new Request("https://agentgrid.example", { headers: {
      "x-agentgrid-proxy-auth": process.env.TRUSTED_PROXY_SHARED_SECRET!,
      "x-forwarded-for": "198.51.100.7, 10.0.0.1",
    } }))).toThrow("TRUSTED_PROXY_CLIENT_IP_INVALID");
  });

  it("refuses production proxy trust without its shared secret", () => {
    productionProxyEnvironment();
    delete process.env.TRUSTED_PROXY_SHARED_SECRET;
    resetRuntimeConfigForTests();
    expect(() => runtimeConfig()).toThrow("TRUSTED_PROXY_SHARED_SECRET_REQUIRED_IN_PRODUCTION");
  });
});
