import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { AgentProtocolClient, AgentProtocolError } from "./client";
import { AgentGridDemoClient } from "./demo-client";
import { sdkSuccessfulResponseSchemas } from "./response-schemas";

const publicTask = {
  id: "task-1",
  title: "A public task",
  description: "A complete public task description for SDK response validation.",
  category: "Development",
  executionMode: "COLLABORATION",
  publisher: "publisher-1",
  state: "OPEN",
  createdAt: "2026-08-31T00:00:00.000Z",
  declaredDurationHours: 48,
  executorCount: 0,
  maxExecutors: 2,
  executorIds: [],
  testerId: null,
  testerIds: [],
  criteria: [],
  artifact: null,
  verification: null,
  reward: null,
  economics: null,
  maintenance: { healthy: [] },
  businessAdoption: null,
} as const;

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("AgentProtocolClient artifact delivery", () => {
  it("encrypts and declares the production-required gzip archive contract", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/api/artifacts/uploads")) {
        return Response.json({
          id: "76ee0786-05f4-44d1-a2d5-47da22d42182",
          objectKey: "tasks/task-1/76ee0786-05f4-44d1-a2d5-47da22d42182",
          uploadUrl: "https://storage.example/upload",
          method: "PUT",
          headers: { "content-type": "application/gzip", "content-length": "32" },
          expiresInSeconds: 900,
        }, { status: 201 });
      }
      if (String(url) === "https://storage.example/upload") return new Response(null, { status: 200 });
      return Response.json({
        id: "76ee0786-05f4-44d1-a2d5-47da22d42182",
        artifactUrl: "s3://agentgrid-artifacts/sealed",
        artifactHash: `sha256:${"a".repeat(64)}`,
        ciphertextHash: `sha256:${"b".repeat(64)}`,
        encrypted: true,
        sizeBytes: 32,
        contentType: "application/gzip",
      });
    }));

    const client = new AgentProtocolClient({ baseUrl: "https://grid.example", agentId: "agent-1", apiKey: "secret" });
    await expect(client.uploadArtifact("task-1", new TextEncoder().encode("not a gzip archive"))).rejects.toThrow("ARTIFACT_GZIP_ARCHIVE_REQUIRED");
    expect(requests).toHaveLength(0);
    await client.uploadArtifact("task-1", gzipSync("delivery"));

    const manifest = JSON.parse(String(requests[0].init?.body));
    expect(manifest).toMatchObject({ taskId: "task-1", agentId: "agent-1", contentType: "application/gzip", encryptionAlgorithm: "AES-256-GCM" });
    expect(requests[1]).toMatchObject({ url: "https://storage.example/upload", init: { method: "PUT" } });
    expect(requests[2].url).toBe("https://grid.example/api/artifacts/76ee0786-05f4-44d1-a2d5-47da22d42182/finalize");

    const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8")) as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(openapi.paths)).toEqual(expect.arrayContaining([
      "/api/tasks", "/api/tasks/{taskId}", "/api/artifacts/uploads", "/api/artifacts/{artifactId}/finalize",
      "/api/artifacts/tasks/{taskId}/download", "/api/artifacts/tasks/{taskId}/contributions",
      "/api/hidden-tests/uploads", "/api/hidden-tests/{manifestId}/content", "/api/hidden-tests/{manifestId}/finalize",
    ]));
    expect((openapi.paths["/api/agents"] as Record<string, unknown>).get).toBeTruthy();
    const registration = openapi.paths["/api/agents"].post as { responses: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> };
    expect(registration.responses["200"].content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/AgentRegistrationResult");
    expect(registration.responses["201"].content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/AgentRegistrationResult");
  });

  it("normalizes URLs, encodes identifiers and never sends Agent credentials on public reads", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return String(url).endsWith("/api/agents")
        ? Response.json({ agents: [] })
        : Response.json({ task: publicTask, reward: null });
    }));
    const client = new AgentProtocolClient({ baseUrl: "https://grid.example/", agentId: "agent-1", apiKey: "secret" });
    await client.getTask("task/with space");
    await client.listAgents();
    expect(requests[0].url).toBe("https://grid.example/api/tasks/task%2Fwith%20space");
    expect(new Headers(requests[0].init?.headers).has("content-type")).toBe(false);
    expect(new Headers(requests[0].init?.headers).has("x-agent-key")).toBe(false);
    expect(requests[1].url).toBe("https://grid.example/api/agents");
    expect(new Headers(requests[1].init?.headers).has("x-agent-id")).toBe(false);
    expect(new Headers(requests[1].init?.headers).has("x-agent-key")).toBe(false);
    expect(requests[0].init?.redirect).toBe("error");
  });

  it("keeps Demo-only mutations out of the production SDK and machine contract", async () => {
    const client = new AgentProtocolClient({ baseUrl: "https://grid.example", agentId: "agent-1", apiKey: "secret" });
    expect(client).not.toHaveProperty("claimTask");
    expect(client).not.toHaveProperty("submitWork");
    expect(client).not.toHaveProperty("submitTest");

    const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
    const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8")) as { paths: Record<string, unknown> };
    for (const route of [
      "/api/tasks/{taskId}/claim",
      "/api/tasks/{taskId}/submit",
      "/api/tasks/{taskId}/test",
    ]) {
      expect(source).not.toContain(route.replace("{taskId}", "${encodeURIComponent(taskId)}"));
      expect(openapi.paths[route]).toBeUndefined();
    }

    const documentedSdkMethods: Record<string, Array<{ path: string; verb: "get" | "post" }>> = {
      publicStatistics: [{ path: "/api/public/stats", verb: "get" }],
      publicDashboard: [{ path: "/api/public/dashboard", verb: "get" }],
      chainConfig: [{ path: "/api/chain/config", verb: "get" }],
      completedTasks: [{ path: "/api/public/tasks/completed", verb: "get" }],
      listTasks: [{ path: "/api/tasks", verb: "get" }],
      listAgents: [{ path: "/api/agents", verb: "get" }],
      getTask: [{ path: "/api/tasks/{taskId}", verb: "get" }],
      leaseJob: [{ path: "/api/agent/jobs/lease", verb: "post" }],
      heartbeatJob: [{ path: "/api/agent/jobs/{jobId}/heartbeat", verb: "post" }],
      completeJob: [{ path: "/api/agent/jobs/{jobId}/complete", verb: "post" }],
      uploadArtifact: [
        { path: "/api/artifacts/uploads", verb: "post" },
        { path: "/api/artifacts/{artifactId}/finalize", verb: "post" },
      ],
      getArtifactForTesting: [{ path: "/api/artifacts/tasks/{taskId}/download", verb: "post" }],
      getTeamContributions: [{ path: "/api/artifacts/tasks/{taskId}/contributions", verb: "post" }],
      getTaskEvaluation: [{ path: "/api/agent/evaluations/{taskId}", verb: "get" }],
      submitSignedTaskEvaluation: [{ path: "/api/agent/evaluations/{taskId}", verb: "post" }],
      submitSignedEvidence: [{ path: "/api/evidence", verb: "post" }],
    };
    const internalMethods = new Set(["constructor", "boundedJson", "request", "publicRequest", "requireAgentId", "discovery"]);
    const exportedMethods = Object.getOwnPropertyNames(AgentProtocolClient.prototype).filter((method) => !internalMethods.has(method)).sort();
    expect(exportedMethods).toEqual(Object.keys(documentedSdkMethods).sort());
    for (const operations of Object.values(documentedSdkMethods)) {
      for (const operation of operations) {
        expect((openapi.paths[operation.path] as Record<string, unknown> | undefined)?.[operation.verb], `${operation.verb.toUpperCase()} ${operation.path}`).toBeTruthy();
      }
    }

    const integrationPage = readFileSync(new URL("../app/agents/integration/page.tsx", import.meta.url), "utf8");
    expect(integrationPage).toContain("const protocolConfig = await api.chainConfig()");
    expect(integrationPage).toContain("protocolConfig.contracts.taskRegistry");
    expect(integrationPage).toContain("api.uploadArtifact(taskId.toString(), archive)");
    expect(integrationPage).not.toContain("api.uploadArtifact(taskId.toString(), archive, \"application/gzip\")");
  });

  it("isolates seeded-state mutations in an explicit loopback-only Demo client", async () => {
    vi.stubEnv("PROTOCOL_MODE", "demo");
    vi.stubEnv("AGENT_QUEUE_MODE", "false");
    expect(() => new AgentGridDemoClient({ baseUrl: "https://grid.example", agentId: "agent-1", apiKey: "secret" }))
      .toThrow("DEMO_CLIENT_LOOPBACK_ONLY");

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json({ state: "CLAIMED" });
    }));
    const demo = new AgentGridDemoClient({ baseUrl: "http://127.0.0.1:3000", agentId: "agent-1", apiKey: "secret" });
    await demo.claimTask("task/one");
    expect(requests[0].url).toBe("http://127.0.0.1:3000/api/tasks/task%2Fone/claim");
    expect(new Headers(requests[0].init?.headers).get("x-agent-id")).toBe("agent-1");
    expect(new Headers(requests[0].init?.headers).get("x-agent-key")).toBe("secret");

    vi.stubEnv("PROTOCOL_MODE", "production");
    expect(() => new AgentGridDemoClient({ baseUrl: "http://127.0.0.1:3000" }))
      .toThrow("DEMO_CLIENT_DISABLED_IN_PRODUCTION");
  });

  it("returns stable bounded errors for invalid HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })));
    const client = new AgentProtocolClient({ baseUrl: "https://grid.example" });
    await expect(client.publicStatistics()).rejects.toMatchObject<Partial<AgentProtocolError>>({
      name: "AgentProtocolError", code: "PROTOCOL_RESPONSE_JSON_INVALID", status: 502,
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "content-length": String(1024 * 1024 + 1) } })));
    await expect(client.publicStatistics()).rejects.toMatchObject<Partial<AgentProtocolError>>({ code: "PROTOCOL_RESPONSE_TOO_LARGE" });

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: "AUTHENTICATION_REQUIRED",
      issues: [{ code: "custom", path: ["wallet"], message: "Wallet session is required" }],
    }, { status: 401 })));
    await expect(client.publicStatistics()).rejects.toMatchObject<Partial<AgentProtocolError>>({ code: "AUTHENTICATION_REQUIRED", status: 401 });
    await expect(client.publicStatistics()).rejects.toMatchObject<Partial<AgentProtocolError>>({
      issues: [{ code: "custom", path: ["wallet"], message: "Wallet session is required" }],
    });

    for (const invalid of [{}, { error: "lowercase" }, { error: "AUTHENTICATION_REQUIRED", injected: true }]) {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(invalid, { status: 400 })));
      await expect(client.publicStatistics()).rejects.toMatchObject<Partial<AgentProtocolError>>({ code: "PROTOCOL_ERROR_RESPONSE_SCHEMA_INVALID", status: 400 });
    }
  });

  it("rejects malformed successful bodies instead of trusting TypeScript casts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const client = new AgentProtocolClient({ baseUrl: "https://grid.example" });
    await expect(client.publicStatistics()).rejects.toMatchObject<Partial<AgentProtocolError>>({
      code: "PROTOCOL_RESPONSE_SCHEMA_INVALID",
      status: 200,
    });

    const invalid = Object.entries(sdkSuccessfulResponseSchemas)
      .filter(([, schema]) => schema.safeParse({}).success)
      .map(([name]) => name);
    expect(invalid).toEqual([]);

    const validStats = {
      generatedAt: "2026-08-31T00:00:00.000Z",
      totalPublishedTasks: 1,
      activeTasks: 1,
      acceptedTasks: 0,
      completedTasks: 0,
      completedTasksLast30Days: 0,
      completedTasksWithTrustedTimestamp: 0,
      completionTimestampCoverage: null,
      settledCompletionRate: null,
      independentlyVerifiedTasks: 0,
      businessAdoptionAttestations: 0,
      totalIssuedRewards: 0,
      completedByCategory: {},
      completedByExecutionMode: {},
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...validStats, injected: true })));
    await expect(client.publicStatistics()).rejects.toMatchObject<Partial<AgentProtocolError>>({ code: "PROTOCOL_RESPONSE_SCHEMA_INVALID" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(validStats)));
    await expect(client.publicStatistics()).resolves.toEqual(validStats);
  });

  it("times out deterministically and rejects unsafe remote endpoints", async () => {
    expect(() => new AgentProtocolClient({ baseUrl: "http://grid.example" })).toThrow("BASE_URL_HTTPS_REQUIRED");
    expect(() => new AgentProtocolClient({ baseUrl: "https://user:secret@grid.example" })).toThrow("BASE_URL_INVALID");
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    const client = new AgentProtocolClient({ baseUrl: "http://127.0.0.1:3000", timeoutMs: 100 });
    await expect(client.publicStatistics()).rejects.toMatchObject<Partial<AgentProtocolError>>({ code: "PROTOCOL_REQUEST_TIMEOUT" });
  });
});
