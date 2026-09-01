import { afterEach, describe, expect, it } from "vitest";
import { resetRuntimeConfigForTests } from "@/lib/env";
import { GET } from "./route";

const previous = { ...process.env };

afterEach(() => {
  process.env = { ...previous };
  resetRuntimeConfigForTests();
});

describe.sequential("readiness configuration failure", () => {
  it("returns structured 503 instead of throwing for a non-BSC production chain", async () => {
    process.env.PROTOCOL_MODE = "production";
    process.env.AUTH_ORIGIN = "https://agentgrid.example";
    process.env.BSC_CHAIN_ID = "56";
    process.env.DATABASE_URL = "postgresql://agentgrid:secret@127.0.0.1:5432/agentgrid";
    process.env.AUTH_SECRET = "production-session-secret-at-least-32-characters";
    resetRuntimeConfigForTests();
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "not-ready", mode: "invalid", checks: { configuration: false, bscRpc: false } });
  });
});
