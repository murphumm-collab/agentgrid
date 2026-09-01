import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletChallenge, SESSION_COOKIE, verifyWalletChallenge } from "@/lib/auth";
import { resetRuntimeConfigForTests } from "@/lib/env";
import { authenticateAgent, registerAgent } from "@/lib/service";
import { resetDatabase } from "@/lib/store";
import { DELETE, POST } from "./route";

const previous = { ...process.env };
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const testDataDirectory = path.join(tmpdir(), `agentgrid-agent-credential-route-${randomUUID()}`);

async function ownerSession() {
  const challenge = await createWalletChallenge(owner.address);
  const signature = await owner.signMessage({ message: challenge.message });
  return (await verifyWalletChallenge({ address: owner.address, nonce: challenge.nonce, message: challenge.message, signature })).token;
}

describe("Agent credential API", () => {
  beforeEach(async () => {
    process.env.PROTOCOL_MODE = "demo";
    process.env.AUTH_ORIGIN = "http://localhost:3000";
    process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
    process.env.BSC_CHAIN_ID = "97";
    process.env.DEMO_DATA_DIRECTORY = testDataDirectory;
    resetRuntimeConfigForTests();
    await resetDatabase();
  });

  afterEach(() => {
    process.env = { ...previous };
    resetRuntimeConfigForTests();
  });

  afterAll(async () => rm(testDataDirectory, { recursive: true, force: true }));

  it("requires the owner session, rotates once, and revokes the replacement", async () => {
    const registered = await registerAgent({
      owner: owner.address,
      name: "Recovery Agent",
      role: "EXECUTOR",
      capabilities: ["typescript"],
      endpoint: "https://agent.example/jobs",
      stake: 1_500,
      stakePositionId: "704",
    });
    const context = { params: Promise.resolve({ id: registered.agent.id }) };
    const unauthorized = await POST(new NextRequest(`http://localhost:3000/api/agents/${registered.agent.id}/credentials`, { method: "POST" }), context);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toContain("no-store");

    const token = await ownerSession();
    const request = (method: "POST" | "DELETE") => new NextRequest(`http://localhost:3000/api/agents/${registered.agent.id}/credentials`, {
      method,
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    });
    const rotated = await POST(request("POST"), context);
    expect(rotated.status).toBe(200);
    const rotation = await rotated.json() as { apiKey: string; agent: Record<string, unknown> };
    expect(rotation.apiKey).toMatch(/^amp_[A-Za-z0-9_-]{43}$/);
    expect(rotation.agent).not.toHaveProperty("apiKeyHash");
    await expect(authenticateAgent(registered.agent.id, registered.apiKey)).rejects.toThrow("AGENT_AUTHENTICATION_FAILED");
    await expect(authenticateAgent(registered.agent.id, rotation.apiKey)).resolves.toMatchObject({ id: registered.agent.id });

    const revoked = await DELETE(request("DELETE"), context);
    expect(revoked.status).toBe(200);
    await expect(authenticateAgent(registered.agent.id, rotation.apiKey)).rejects.toThrow("AGENT_AUTHENTICATION_FAILED");
  });
});
