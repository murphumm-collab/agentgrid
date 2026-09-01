import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const previous = process.env.PUBLIC_SHOWCASE_MODE;
const previousProtocolMode = process.env.PROTOCOL_MODE;

afterEach(() => {
  if (previous === undefined) delete process.env.PUBLIC_SHOWCASE_MODE;
  else process.env.PUBLIC_SHOWCASE_MODE = previous;
  if (previousProtocolMode === undefined) delete process.env.PROTOCOL_MODE;
  else process.env.PROTOCOL_MODE = previousProtocolMode;
});

describe("public showcase middleware", () => {
  it("blocks API writes while preserving read requests and locale switching", () => {
    process.env.PUBLIC_SHOWCASE_MODE = "true";
    const denied = middleware(new NextRequest("https://preview.example/api/tasks", { method: "POST" }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("x-agentgrid-showcase")).toBe("read-only");
    expect(denied.headers.get("cache-control")).toBe("no-store");

    const readable = middleware(new NextRequest("https://preview.example/api/tasks", { method: "GET" }));
    expect(readable.status).toBe(200);
    expect(readable.headers.get("x-agentgrid-showcase")).toBe("read-only");

    const locale = middleware(new NextRequest("https://preview.example/api/locale", { method: "POST" }));
    expect(locale.status).toBe(200);
  });

  it("does not block normal-mode API writes", () => {
    delete process.env.PUBLIC_SHOWCASE_MODE;
    process.env.PROTOCOL_MODE = "production";
    const response = middleware(new NextRequest("https://app.example/api/tasks", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });

  it("defaults every non-public API to private no-store while leaving public projections route-owned", () => {
    process.env.PROTOCOL_MODE = "production";
    for (const pathname of [
      "/api/auth/nonce",
      "/api/agents",
      "/api/artifacts/uploads",
      "/api/admin/metrics",
      "/api/health/ready",
    ]) {
      const response = middleware(new NextRequest(`https://app.example${pathname}`));
      expect(response.headers.get("cache-control"), pathname).toBe("private, no-store, max-age=0");
    }

    const publicProjection = middleware(new NextRequest("https://app.example/api/public/dashboard"));
    expect(publicProjection.headers.get("cache-control")).toBeNull();
  });

  it("rejects browser cross-origin demo writes while allowing same-origin browsers and origin-less agents", () => {
    process.env.PROTOCOL_MODE = "demo";
    const denied = middleware(new NextRequest("http://127.0.0.1:3000/api/tasks/task-1/rewards/tranche-1/claim", {
      method: "POST", headers: { host: "127.0.0.1:3000", origin: "https://attacker.example" },
    }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(middleware(new NextRequest("http://127.0.0.1:3000/api/tasks", {
      method: "POST", headers: { host: "attacker.example", origin: "http://attacker.example" },
    })).status).toBe(403);

    expect(middleware(new NextRequest("http://127.0.0.1:3000/api/tasks", {
      method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    })).status).toBe(200);
    expect(middleware(new NextRequest("http://127.0.0.1:3000/api/agent/jobs/lease", { method: "POST" })).status).toBe(200);
  });

  it("rejects DNS-rebinding-style demo reads and pages before routing", async () => {
    process.env.PROTOCOL_MODE = "demo";
    for (const pathname of ["/api/protocol", "/dashboard"]) {
      const denied = middleware(new NextRequest(`http://127.0.0.1:3000${pathname}`, {
        method: "GET", headers: { host: "attacker.example" },
      }));
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ error: "INVALID_DEMO_HOST" });
      expect(denied.headers.get("cache-control")).toBe("no-store");
    }
    expect(middleware(new NextRequest("http://localhost:3000/api/protocol", {
      method: "GET", headers: { host: "localhost:3000" },
    })).status).toBe(200);
  });
});
