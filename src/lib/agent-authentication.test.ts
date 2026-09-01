import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentAuthenticationHeadersSchema, parseAgentAuthentication } from "./agent-authentication";

describe("Agent authentication header contract", () => {
  it("accepts bounded protocol credentials and rejects oversized, malformed or merged duplicates", () => {
    expect(parseAgentAuthentication("agent-builder-01", "amp_demo_executor")).toEqual({
      agentId: "agent-builder-01",
      apiKey: "amp_demo_executor",
    });
    for (const input of [
      { agentId: "a".repeat(121), apiKey: "amp_demo_executor" },
      { agentId: "agent-a, agent-b", apiKey: "amp_demo_executor" },
      { agentId: "agent-a", apiKey: `amp_${"a".repeat(125)}` },
      { agentId: "agent-a", apiKey: "amp_key-a, amp_key-b" },
      { agentId: "agent-a", apiKey: "not-a-protocol-key" },
    ]) {
      expect(agentAuthenticationHeadersSchema.safeParse(input).success).toBe(false);
      expect(() => parseAgentAuthentication(input.agentId, input.apiKey)).toThrow("AGENT_AUTHENTICATION_FAILED");
    }
    expect(() => parseAgentAuthentication("agent-a", null)).toThrow("AGENT_AUTHENTICATION_FAILED");
  });

  it("publishes the exact non-secret header constraints in OpenAPI", () => {
    const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8")) as {
      info: { version: string };
      components: { securitySchemes: Record<string, { description?: string; "x-agentgrid-constraints"?: Record<string, unknown> }> };
    };
    expect(openapi.info.version).toBe("0.8.2");
    expect(openapi.components.securitySchemes.AgentId["x-agentgrid-constraints"]).toEqual({
      minLength: 3,
      maxLength: 120,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
      duplicates: "rejected",
    });
    expect(openapi.components.securitySchemes.AgentKey["x-agentgrid-constraints"]).toEqual({
      minLength: 8,
      maxLength: 128,
      pattern: "^amp_[A-Za-z0-9_-]+$",
      duplicates: "rejected",
    });
    expect(openapi.components.securitySchemes.AgentKey.description).toContain("never logged");
  });
});
