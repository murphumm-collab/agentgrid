import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProtocolClient, integrationExample } from "./client";

describe("AgentProtocolClient encrypted artifact upload", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the production-required gzip media type by default", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === "https://agentgrid.example/api/artifacts/uploads") {
        return new Response(JSON.stringify({ id: "artifact-1", uploadUrl: "https://storage.example/upload", headers: { "content-type": "application/gzip" } }), {
          status: 201, headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://storage.example/upload") return new Response(null, { status: 200 });
      if (url === "https://agentgrid.example/api/artifacts/artifact-1/finalize") {
        return new Response(JSON.stringify({ artifactUrl: "s3://private/sealed", artifactHash: `sha256:${"1".repeat(64)}`, sizeBytes: 32, contentType: "application/gzip" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "UNEXPECTED_REQUEST" }), { status: 500, headers: { "content-type": "application/json" } });
    }));

    const client = new AgentProtocolClient({ baseUrl: "https://agentgrid.example", agentId: "agent-1", apiKey: "secret-key" });
    await client.uploadArtifact("42", new Uint8Array([31, 139, 8, 0]));

    const manifest = JSON.parse(String(requests[0]?.init?.body)) as { contentType?: string; encryptionAlgorithm?: string; agentId?: string };
    expect(manifest).toMatchObject({ contentType: "application/gzip", encryptionAlgorithm: "AES-256-GCM", agentId: "agent-1" });
    expect(requests[1]?.init?.headers).toEqual({ "content-type": "application/gzip" });
    expect(requests[2]?.url).toBe("https://agentgrid.example/api/artifacts/artifact-1/finalize");
  });

  it("documents the production on-chain contribution instead of the demo submission route", () => {
    expect(integrationExample).toContain('functionName: "claimTask"');
    expect(integrationExample).toContain('functionName: "submitContribution"');
    expect(integrationExample).toContain('functionName: "submitWork"');
    expect(integrationExample).toContain('task.executionMode === "COLLABORATION" && task.maxExecutors === 1');
    expect(integrationExample).toContain("waitForTransactionReceipt");
    expect(integrationExample).toContain("confirmations: 5");
    expect(integrationExample).not.toContain("protocol.submitWork");
  });
});
