import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetRuntimeConfigForTests } from "@/lib/env";
import { resetDatabase } from "@/lib/store";
import { GET, POST } from "./route";

const previous = { ...process.env };
const testDataDirectory = path.join(tmpdir(), `agentgrid-public-agents-${randomUUID()}`);

describe("public Agent directory", () => {
  beforeEach(async () => {
    process.env.PROTOCOL_MODE = "demo";
    process.env.AUTH_ORIGIN = "http://localhost:3000";
    process.env.DEMO_DATA_DIRECTORY = testDataDirectory;
    resetRuntimeConfigForTests();
    await resetDatabase();
  });

  afterEach(() => {
    process.env = { ...previous };
    resetRuntimeConfigForTests();
  });

  afterAll(async () => rm(testDataDirectory, { recursive: true, force: true }));

  it("returns only the documented public Agent projection", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json() as { agents: Array<Record<string, unknown>> };
    expect(body.agents.length).toBeGreaterThan(0);
    expect(Object.keys(body.agents[0]).sort()).toEqual([
      "capabilities", "completedTasks", "id", "name", "online", "owner", "quality", "reputation", "role", "stake",
    ]);
    const serialized = JSON.stringify(body);
    for (const field of ["endpoint", "apiKey", "apiKeyHash", "apiKeySalt", "scopes", "stakePositionId", "revokedAt"]) {
      expect(serialized).not.toContain(`\"${field}\"`);
    }
  });

  it("returns 200 and the same identity with a replacement key for an exact retry", async () => {
    const registration = {
      owner: `0x${"1".repeat(40)}`, name: "Route Recovery Agent", role: "EXECUTOR",
      capabilities: ["typescript"], endpoint: "https://agent.example/jobs",
      stake: 1_500, stakePositionId: "702",
    };
    const request = () => new NextRequest("http://localhost:3000/api/agents", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(registration),
    });
    const created = await POST(request());
    const first = await created.json() as { agent: { id: string }; apiKey: string; recovered: boolean };
    expect(created.status).toBe(201);
    expect(first.recovered).toBe(false);

    const retried = await POST(request());
    const second = await retried.json() as typeof first;
    expect(retried.status).toBe(200);
    expect(second.recovered).toBe(true);
    expect(second.agent.id).toBe(first.agent.id);
    expect(second.apiKey).not.toBe(first.apiKey);
    expect(second.agent).not.toHaveProperty("apiKeyHash");
    expect(second.agent).not.toHaveProperty("apiKeySalt");

    const mismatch = await POST(new NextRequest("http://localhost:3000/api/agents", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...registration, name: "Different Recovery Agent" }),
    }));
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ error: "AGENT_REGISTRATION_RECOVERY_MISMATCH" });
  });

  it("rejects malformed, incomplete and extended registration bodies before mutation", async () => {
    const valid = {
      owner: `0x${"1".repeat(40)}`, name: "Schema Boundary Agent", role: "EXECUTOR",
      capabilities: ["typescript"], endpoint: "https://agent.example/jobs",
      stake: 1_500, stakePositionId: "703",
    };
    const missingStakePosition = {
      owner: valid.owner, name: valid.name, role: valid.role,
      capabilities: valid.capabilities, endpoint: valid.endpoint, stake: valid.stake,
    };
    for (const body of [
      { ...valid, unexpected: true },
      { ...valid, owner: "not-a-wallet" },
      missingStakePosition,
      { ...valid, scopes: ["tasks:claim", "tasks:claim"] },
    ]) {
      const response = await POST(new NextRequest("http://localhost:3000/api/agents", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }));
      expect(response.status).toBe(400);
    }
    const snapshot = await GET();
    const payload = await snapshot.json() as { agents: Array<{ name: string }> };
    expect(payload.agents.some((agent) => agent.name === valid.name)).toBe(false);
  });

  it("binds the strict runtime registration boundary to OpenAPI 0.8.0", () => {
    const openapi = JSON.parse(readFileSync(new URL("../../../../public/openapi.json", import.meta.url), "utf8")) as {
      info: { version: string };
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
      components: { schemas: { AgentRegistration: Record<string, unknown> & { properties: Record<string, Record<string, unknown>> } } };
    };
    const schema = openapi.components.schemas.AgentRegistration;
    expect(openapi.info.version).toBe("0.8.0");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("stakePositionId");
    expect(schema.properties.owner.pattern).toBe("^0x[0-9a-fA-F]{40}$");
    expect(schema.properties.scopes).toMatchObject({ maxItems: 5, uniqueItems: true });
    expect(Object.keys(openapi.paths["/api/agents"].post?.responses ?? {}).sort()).toEqual([
      "200", "201", "400", "401", "403", "409", "413", "415", "429", "500",
    ]);
  });
});
