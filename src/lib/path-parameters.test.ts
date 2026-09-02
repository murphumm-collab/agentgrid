import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentIdPathParameterSchema,
  demoTaskIdPathParameterSchema,
  jobIdPathParameterSchema,
  onchainTaskIdPathParameterSchema,
  uuidPathParameterSchema,
} from "./path-parameters";

const root = process.cwd();
const errorRef = "#/components/schemas/ProtocolErrorResponse";
const uuidSchema = { type: "string", format: "uuid" };
const taskSchema = { type: "string", minLength: 1, maxLength: 78, pattern: "^[1-9][0-9]*$" };
const agentSchema = { type: "string", minLength: 3, maxLength: 120, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" };
const jobSchema = { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" };

describe("production path parameter contracts", () => {
  it("rejects malformed or oversized UUID, chain, Agent and queue identifiers", () => {
    expect(uuidPathParameterSchema.parse("07a92c98-e8c9-40f4-8f79-91a57f10186b")).toBeTruthy();
    expect(onchainTaskIdPathParameterSchema.parse("1")).toBe("1");
    expect(onchainTaskIdPathParameterSchema.parse("9".repeat(78))).toHaveLength(78);
    expect(agentIdPathParameterSchema.parse("agent-builder-01")).toBe("agent-builder-01");
    expect(jobIdPathParameterSchema.parse(`97:0x${"a".repeat(64)}:0:EXECUTE_TASK:0`)).toBeTruthy();
    expect(demoTaskIdPathParameterSchema.parse("task-demo-001")).toBe("task-demo-001");
    for (const [schema, value] of [
      [uuidPathParameterSchema, "not-a-uuid"],
      [onchainTaskIdPathParameterSchema, "0"],
      [onchainTaskIdPathParameterSchema, "01"],
      [onchainTaskIdPathParameterSchema, "9".repeat(79)],
      [agentIdPathParameterSchema, "agent/a"],
      [jobIdPathParameterSchema, "j".repeat(201)],
      [demoTaskIdPathParameterSchema, "task?query"],
    ] as const) expect(schema.safeParse(value).success, value).toBe(false);
  });

  it("binds all 18 production dynamic-path operations to exact OpenAPI schemas and 400 errors", () => {
    const openapi = JSON.parse(readFileSync(path.join(root, "public/openapi.json"), "utf8")) as {
      info: { version: string };
      paths: Record<string, Record<string, { operationId?: string; parameters?: Array<{ in: string; schema: Record<string, unknown> }>; responses?: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> }>>;
    };
    expect(openapi.info.version).toBe("0.8.15");
    const contracts: Array<[string, string[], Record<string, unknown>]> = [
      ["/api/tasks/{taskId}", ["get"], taskSchema],
      ["/api/chain/task-commitments/{commitmentId}/transaction", ["post", "delete"], uuidSchema],
      ["/api/agents/{agentId}/credentials", ["post", "delete"], agentSchema],
      ["/api/agent/jobs/{jobId}/heartbeat", ["post"], jobSchema],
      ["/api/agent/jobs/{jobId}/complete", ["post"], jobSchema],
      ["/api/agent/evaluations/{taskId}", ["get", "post"], taskSchema],
      ["/api/artifacts/{artifactId}/finalize", ["post"], uuidSchema],
      ["/api/artifacts/tasks/{taskId}/download", ["post"], taskSchema],
      ["/api/artifacts/tasks/{taskId}/contributions", ["post"], taskSchema],
      ["/api/artifacts/tasks/{taskId}/release", ["post"], taskSchema],
      ["/api/hidden-tests/{manifestId}/content", ["put"], uuidSchema],
      ["/api/hidden-tests/{manifestId}/finalize", ["post"], uuidSchema],
      ["/api/notifications/{notificationId}/read", ["post"], uuidSchema],
      ["/api/tasks/{taskId}/business-adoption", ["get", "post"], taskSchema],
    ];
    let operations = 0;
    for (const [route, methods, schema] of contracts) for (const method of methods) {
      operations += 1;
      const operation = openapi.paths[route]?.[method];
      expect(operation?.parameters?.filter((parameter) => parameter.in === "path").map((parameter) => parameter.schema), `${method} ${route}`).toEqual([schema]);
      expect(operation?.responses?.["400"]?.content?.["application/json"]?.schema?.$ref, `${method} ${route} 400`).toBe(errorRef);
    }
    expect(operations).toBe(18);
    const hidden = openapi.paths["/api/hidden-tests/{manifestId}/content"].put.responses!;
    for (const status of ["400", "401", "403", "409", "413", "415", "500"]) {
      expect(hidden[status]?.content?.["application/json"]?.schema?.$ref, `hidden content ${status}`).toBe(errorRef);
    }
  });

  it("requires each production dynamic route source to execute its shared path schema", () => {
    const expected = new Map<string, string>([
      ["src/app/api/tasks/[id]/route.ts", "onchainTaskIdPathParameterSchema"],
      ["src/app/api/chain/task-commitments/[id]/transaction/route.ts", "uuidPathParameterSchema.parse"],
      ["src/app/api/agents/[id]/credentials/route.ts", "agentIdPathParameterSchema.parse"],
      ["src/app/api/agent/jobs/[id]/heartbeat/route.ts", "jobIdPathParameterSchema.parse"],
      ["src/app/api/agent/jobs/[id]/complete/route.ts", "jobIdPathParameterSchema.parse"],
      ["src/app/api/agent/evaluations/[taskId]/route.ts", "onchainTaskIdPathParameterSchema.parse"],
      ["src/app/api/artifacts/[id]/finalize/route.ts", "uuidPathParameterSchema.parse"],
      ["src/app/api/artifacts/tasks/[taskId]/download/route.ts", "onchainTaskIdPathParameterSchema.parse"],
      ["src/app/api/artifacts/tasks/[taskId]/contributions/route.ts", "onchainTaskIdPathParameterSchema.parse"],
      ["src/app/api/artifacts/tasks/[taskId]/release/route.ts", "onchainTaskIdPathParameterSchema.parse"],
      ["src/app/api/hidden-tests/[id]/content/route.ts", "uuidPathParameterSchema.parse"],
      ["src/app/api/hidden-tests/[id]/finalize/route.ts", "uuidPathParameterSchema.parse"],
      ["src/app/api/notifications/[id]/read/route.ts", "uuidPathParameterSchema.parse"],
      ["src/app/api/tasks/[id]/business-adoption/route.ts", "onchainTaskIdPathParameterSchema.parse"],
    ]);
    for (const [file, marker] of expected) expect(readFileSync(path.join(root, file), "utf8"), file).toContain(marker);
  });
});
