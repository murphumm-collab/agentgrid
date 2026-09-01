import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { completedTaskQuerySchema } from "./completed-task-query";

const root = process.cwd();

describe("production parameter contracts", () => {
  it("keeps completed-task query bounds aligned with the strict runtime schema", () => {
    const openapi = JSON.parse(readFileSync(path.join(root, "public/openapi.json"), "utf8")) as {
      paths: Record<string, { get: { parameters: Array<{ name: string; in: string; schema: Record<string, unknown> }>; responses: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> } }>;
    };
    const operation = openapi.paths["/api/public/tasks/completed"].get;
    const query = operation.parameters.filter((parameter) => parameter.in === "query");
    expect(query.map((parameter) => parameter.name).sort()).toEqual([...completedTaskQuerySchema.keyof().options].sort());
    expect(query.find((parameter) => parameter.name === "limit")?.schema).toMatchObject({ type: "integer", minimum: 1, maximum: 100, default: 25 });
    expect(query.find((parameter) => parameter.name === "cursor")?.schema).toMatchObject({ type: "string", minLength: 1, maxLength: 160 });
    expect(query.find((parameter) => parameter.name === "category")?.schema).toMatchObject({ type: "string", minLength: 2, maxLength: 64 });
    expect(operation.responses["400"].content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/ProtocolErrorResponse");
  });

  it("uses the wallet session as the sole hidden-test upload identity", () => {
    const openapi = JSON.parse(readFileSync(path.join(root, "public/openapi.json"), "utf8")) as {
      paths: Record<string, { put: { security?: Array<Record<string, unknown>>; parameters: Array<{ name: string; in: string }> } }>;
    };
    const operation = openapi.paths["/api/hidden-tests/{manifestId}/content"].put;
    expect(operation.security).toEqual([{ WalletSession: [] }]);
    expect(operation.parameters).toEqual([{ name: "manifestId", in: "path", required: true, schema: { type: "string", format: "uuid" } }]);
    for (const file of [
      "src/app/api/hidden-tests/[id]/content/route.ts",
      "src/components/new-task-form.tsx",
      "scripts/agent-delivery-smoke.ts",
    ]) expect(readFileSync(path.join(root, file), "utf8"), file).not.toContain("x-publisher");
  });
});
