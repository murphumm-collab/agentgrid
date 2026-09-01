import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apiErrorResponseSchema } from "./api-error-schema";

const apiRoot = path.resolve(process.cwd(), "src/app/api");

function routeFiles(directory = apiRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(target);
    return entry.name === "route.ts" ? [target] : [];
  });
}

function sourceRoute(file: string) {
  return `/api/${path.dirname(path.relative(apiRoot, file)).split(path.sep).join("/")}`;
}

function openapiRoute(route: string) {
  return route
    .replace("/api/agent/jobs/[id]", "/api/agent/jobs/{jobId}")
    .replace("/api/agents/[id]", "/api/agents/{agentId}")
    .replace("/api/artifacts/[id]", "/api/artifacts/{artifactId}")
    .replace("/api/chain/task-commitments/[id]", "/api/chain/task-commitments/{commitmentId}")
    .replace("/api/hidden-tests/[id]", "/api/hidden-tests/{manifestId}")
    .replace("/api/notifications/[id]", "/api/notifications/{notificationId}")
    .replace("/api/tasks/[id]", "/api/tasks/{taskId}")
    .replaceAll("[taskId]", "{taskId}")
    .replaceAll("[trancheId]", "{trancheId}");
}

const intentionalExclusions = new Map<string, "admin" | "demo-only" | "operational" | "browser-preference">([
  ["GET /api/admin/edge-probe", "admin"],
  ["GET /api/admin/metrics", "admin"],
  ["GET /api/admin/pilot-readiness", "admin"],
  ["GET /api/admin/release-readiness", "admin"],
  ["POST /api/faucet", "demo-only"],
  ["GET /api/health/live", "operational"],
  ["GET /api/health/ready", "operational"],
  ["POST /api/locale", "browser-preference"],
  ["GET /api/protocol", "admin"],
  ["POST /api/stake/[id]/credit", "demo-only"],
  ["POST /api/stake", "demo-only"],
  ["POST /api/tasks/[id]/claim", "demo-only"],
  ["POST /api/tasks/[id]/maintenance", "demo-only"],
  ["POST /api/tasks/[id]/review", "demo-only"],
  ["POST /api/tasks/[id]/rewards/[trancheId]/claim", "demo-only"],
  ["POST /api/tasks/[id]/submit", "demo-only"],
  ["POST /api/tasks", "demo-only"],
]);

const newlyClosedSuccessRoutes = new Map<string, string[]>([
  ["task-spec-assistant/route.ts", ["taskSpecAssistantResponseSchema.parse"]],
  ["chain/task-commitments/route.ts", ["pendingTaskCommitmentResponseSchema.parse", "createTaskCommitmentResponseSchema.parse"]],
  ["chain/task-commitments/[id]/transaction/route.ts", ["taskCommitmentTransactionResponseSchema.parse", "clearedTaskCommitmentTransactionResponseSchema.parse"]],
  ["agents/[id]/credentials/route.ts", ["rotateAgentCredentialResponseSchema.parse", "revokeAgentCredentialResponseSchema.parse"]],
  ["hidden-tests/uploads/route.ts", ["hiddenTestUploadResponseSchema.parse"]],
  ["hidden-tests/[id]/content/route.ts", ["hiddenTestContentResponseSchema.parse"]],
  ["hidden-tests/[id]/finalize/route.ts", ["hiddenTestFinalizeResponseSchema.parse"]],
]);

describe("production route machine-contract inventory", () => {
  it("forces every route operation into OpenAPI or an explicit non-protocol exclusion", () => {
    const openapi = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/openapi.json"), "utf8")) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    const advertised = new Set(Object.entries(openapi.paths).flatMap(([route, methods]) =>
      Object.entries(methods).flatMap(([method, operation]) => operation.operationId ? [`${method.toUpperCase()} ${route}`] : [])));
    const actual = new Set<string>();
    for (const file of routeFiles()) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/export async function (GET|POST|PUT|DELETE|PATCH)\b/g)) {
        const sourceKey = `${match[1]} ${sourceRoute(file)}`;
        const advertisedKey = `${match[1]} ${openapiRoute(sourceRoute(file))}`;
        actual.add(sourceKey);
        expect(advertised.has(advertisedKey) || intentionalExclusions.has(sourceKey), sourceKey).toBe(true);
      }
    }
    const accounted = new Set([...advertised].map((key) => {
      const [method, route] = key.split(" ", 2);
      const source = route
        .replace("/api/agent/jobs/{jobId}", "/api/agent/jobs/[id]")
        .replace("/api/agents/{agentId}", "/api/agents/[id]")
        .replace("/api/artifacts/{artifactId}", "/api/artifacts/[id]")
        .replace("/api/chain/task-commitments/{commitmentId}", "/api/chain/task-commitments/[id]")
        .replace("/api/hidden-tests/{manifestId}", "/api/hidden-tests/[id]")
        .replace("/api/notifications/{notificationId}", "/api/notifications/[id]")
        .replace("/api/tasks/{taskId}", "/api/tasks/[id]")
        .replaceAll("{taskId}", "[taskId]")
        .replaceAll("{trancheId}", "[trancheId]");
      return `${method} ${source}`;
    }).concat([...intentionalExclusions.keys()]));
    expect(accounted).toEqual(actual);
    expect(advertised.size).toBe(37);
    expect(intentionalExclusions.size).toBe(17);
  });

  it("requires every production success response to name a closed JSON envelope", () => {
    const openapi = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/openapi.json"), "utf8")) as {
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string; additionalProperties?: boolean } }> }> }>>;
      components: { schemas: Record<string, { type?: string | string[]; additionalProperties?: boolean; oneOf?: Array<{ type?: string; additionalProperties?: boolean }> }> };
    };
    let successes = 0;
    let operations = 0;
    for (const methods of Object.values(openapi.paths)) for (const operation of Object.values(methods)) {
      if (!operation.operationId) continue;
      operations += 1;
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!/^2\d\d$/.test(status)) continue;
        successes += 1;
        const schema = response.content?.["application/json"]?.schema;
        expect(schema, `${operation.operationId} ${status}`).toBeTruthy();
        if (schema?.$ref) {
          const name = schema.$ref.split("/").at(-1)!;
          const component = openapi.components.schemas[name];
          expect(component, `${operation.operationId} ${status} ${schema.$ref}`).toBeTruthy();
          const objectEnvelopes = component.oneOf?.filter((item) => item.type === "object") ?? (component.type === "object" ? [component] : []);
          expect(objectEnvelopes.length, name).toBeGreaterThan(0);
          for (const envelope of objectEnvelopes) expect(envelope.additionalProperties, name).toBe(false);
        } else {
          expect(schema?.additionalProperties, `${operation.operationId} ${status}`).toBe(false);
        }
      }
    }
    expect(operations).toBe(37);
    expect(successes).toBe(38);
  });

  it("binds every advertised production failure to the strict runtime error envelope", () => {
    const openapi = JSON.parse(readFileSync(path.resolve(process.cwd(), "public/openapi.json"), "utf8")) as {
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
      components: { schemas: Record<string, { additionalProperties?: boolean; required?: string[] }> };
    };
    const component = openapi.components.schemas.ProtocolErrorResponse;
    expect(component.additionalProperties).toBe(false);
    expect([...(component.required ?? [])].sort()).toEqual(["error"]);
    expect([...apiErrorResponseSchema.keyof().options].sort()).toEqual(["error", "issues"]);
    let failures = 0;
    for (const methods of Object.values(openapi.paths)) for (const operation of Object.values(methods)) {
      if (!operation.operationId) continue;
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!/^[45]\d\d$/.test(status)) continue;
        failures += 1;
        expect(response.content?.["application/json"]?.schema?.$ref, `${operation.operationId} ${status}`)
          .toBe("#/components/schemas/ProtocolErrorResponse");
      }
    }
    expect(failures).toBe(185);
  });

  it("keeps formerly status-only authenticated successes parsed and private", () => {
    for (const [relative, parsers] of newlyClosedSuccessRoutes) {
      const source = readFileSync(path.join(apiRoot, relative), "utf8");
      for (const parser of parsers) expect(source, `${relative}: ${parser}`).toContain(parser);
      expect(source, relative).toContain('"cache-control": "private, no-store"');
    }
  });
});
