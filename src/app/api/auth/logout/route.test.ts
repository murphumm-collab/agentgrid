import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRuntimeConfigForTests } from "@/lib/env";
import { POST } from "./route";

const previous = Object.fromEntries(["PROTOCOL_MODE", "DATABASE_URL", "AUTH_SECRET", "AUTH_ORIGIN"].map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.PROTOCOL_MODE = "production";
  process.env.DATABASE_URL = "postgresql://agentgrid:secret@127.0.0.1:5432/agentgrid";
  process.env.AUTH_SECRET = "production-auth-secret-at-least-32-characters";
  process.env.AUTH_ORIGIN = "https://grid.example";
  resetRuntimeConfigForTests();
});

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRuntimeConfigForTests();
});

describe("wallet logout route", () => {
  it("returns a stable 403 for a cross-origin request", async () => {
    const response = await POST(new Request("https://grid.example/api/auth/logout", {
      method: "POST", headers: { origin: "https://attacker.example" },
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_REQUEST_ORIGIN" });
  });

  it("expires the production session cookie with the original security attributes", async () => {
    const response = await POST(new Request("https://grid.example/api/auth/logout", {
      method: "POST", headers: { origin: "https://grid.example" },
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("agentgrid-session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Max-Age=0");
  });
});
