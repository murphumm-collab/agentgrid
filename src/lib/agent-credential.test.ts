import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRuntimeConfigForTests } from "./env";
import { readDatabase, resetDatabase } from "./store";
import { authenticateAgent, protocolSnapshot, revokeAgentCredential, rotateAgentCredential } from "./service";

const previous = { ...process.env };
const testDataDirectory = path.join(tmpdir(), `agentgrid-agent-credential-${randomUUID()}`);

describe("Agent credential lifecycle", () => {
  beforeEach(async () => {
    process.env.PROTOCOL_MODE = "demo";
    process.env.DEMO_DATA_DIRECTORY = testDataDirectory;
    resetRuntimeConfigForTests();
    await resetDatabase();
  });

  afterEach(() => {
    process.env = { ...previous };
    resetRuntimeConfigForTests();
  });

  afterAll(async () => rm(testDataDirectory, { recursive: true, force: true }));

  it("lets only the wallet owner rotate a lost key and invalidates the previous key", async () => {
    await expect(rotateAgentCredential("agent-builder-01", "0xAttacker")).rejects.toThrow("AGENT_CREDENTIAL_OWNER_DENIED");
    const rotated = await rotateAgentCredential("agent-builder-01", "0xagentbuilder");
    expect(rotated.apiKey).toMatch(/^amp_[A-Za-z0-9_-]{43}$/);
    expect(rotated.agent).not.toHaveProperty("apiKey");
    expect(rotated.agent).not.toHaveProperty("apiKeyHash");
    expect(rotated.agent).not.toHaveProperty("apiKeySalt");
    await expect(authenticateAgent("agent-builder-01", "amp_demo_executor")).rejects.toThrow("AGENT_AUTHENTICATION_FAILED");
    await expect(authenticateAgent("agent-builder-01", rotated.apiKey)).resolves.toMatchObject({ id: "agent-builder-01" });
  });

  it("revokes immediately and a later owner rotation explicitly reactivates the identity", async () => {
    const revoked = await revokeAgentCredential("agent-builder-01", "0xAgentBuilder");
    expect(revoked.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await expect(revokeAgentCredential("agent-builder-01", "0xAgentBuilder")).resolves.toMatchObject({ revokedAt: revoked.revokedAt });
    const stored = (await readDatabase()).agents.find((agent) => agent.id === "agent-builder-01");
    expect(stored).not.toHaveProperty("apiKey");
    expect(stored).not.toHaveProperty("apiKeyHash");
    expect(stored).not.toHaveProperty("apiKeySalt");
    await expect(authenticateAgent("agent-builder-01", "amp_demo_executor")).rejects.toThrow("AGENT_AUTHENTICATION_FAILED");
    expect((await protocolSnapshot()).agents.find((agent) => agent.id === "agent-builder-01")?.online).toBe(false);

    const restored = await rotateAgentCredential("agent-builder-01", "0xAgentBuilder");
    expect(restored.agent.revokedAt).toBeNull();
    await expect(authenticateAgent("agent-builder-01", restored.apiKey)).resolves.toMatchObject({ online: true });
  });
});
