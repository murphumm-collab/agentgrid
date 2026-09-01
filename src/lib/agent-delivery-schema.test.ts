import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agentIdBodySchema,
  artifactUploadRequestSchema,
  hiddenTestUploadRequestSchema,
} from "./agent-delivery-schema";

const artifactUpload = {
  taskId: "42",
  agentId: "agent-1",
  sha256: "11".repeat(32),
  sizeBytes: 128,
  contentType: "application/gzip" as const,
  plaintextSha256: "22".repeat(32),
  encryptionAlgorithm: "AES-256-GCM" as const,
  contentIv: "a".repeat(16),
  encryptionKey: "b".repeat(40),
};

const hiddenTestUpload = {
  publisher: `0x${"1".repeat(40)}`,
  sha256: "33".repeat(32),
  plaintextSha256: "44".repeat(32),
  sizeBytes: 128,
  contentType: "application/gzip" as const,
  encryptionAlgorithm: "AES-256-GCM" as const,
  contentIv: "c".repeat(16),
  encryptionKey: "d".repeat(40),
};

describe("Agent delivery request contracts", () => {
  it("rejects unknown properties for every OpenAPI-closed delivery body", () => {
    expect(agentIdBodySchema.safeParse({ agentId: "agent-1", unexpected: true }).success).toBe(false);
    expect(artifactUploadRequestSchema.safeParse({ ...artifactUpload, unexpected: true }).success).toBe(false);
    expect(hiddenTestUploadRequestSchema.safeParse({ ...hiddenTestUpload, unexpected: true }).success).toBe(false);
    expect(artifactUploadRequestSchema.parse(artifactUpload)).toEqual(artifactUpload);
    expect(hiddenTestUploadRequestSchema.parse(hiddenTestUpload)).toEqual(hiddenTestUpload);
  });

  it("binds shared runtime fields and failure statuses to OpenAPI 0.8.5", () => {
    const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8")) as {
      info: { version: string };
      paths: Record<string, { post: { responses: Record<string, unknown> } }>;
      components: { schemas: Record<string, { additionalProperties?: boolean; required?: string[] }> };
    };
    expect(openapi.info.version).toBe("0.8.5");
    for (const [name, fields] of [
      ["AgentIdBody", ["agentId"]],
      ["ArtifactUploadRequest", Object.keys(artifactUpload)],
      ["HiddenTestUploadRequest", Object.keys(hiddenTestUpload)],
    ] as const) {
      expect(openapi.components.schemas[name].additionalProperties).toBe(false);
      expect([...(openapi.components.schemas[name].required ?? [])].sort()).toEqual([...fields].sort());
    }
    for (const route of [
      "/api/artifacts/uploads",
      "/api/artifacts/{artifactId}/finalize",
      "/api/artifacts/tasks/{taskId}/download",
      "/api/artifacts/tasks/{taskId}/contributions",
    ]) {
      const statuses = openapi.paths[route].post.responses;
      for (const status of ["400", "401", "413", "415"]) expect(statuses[status]).toBeTruthy();
    }
    const hiddenStatuses = openapi.paths["/api/hidden-tests/uploads"].post.responses;
    for (const status of ["400", "401", "403", "413", "415"]) expect(hiddenStatuses[status]).toBeTruthy();
  });
});
