import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAiDashboard } from "../lib/ai-dashboard";
import { publicTaskStatistics } from "../lib/public-task-view";
import {
  discoveryResponseSchema,
  publicDashboardResponseSchema,
  publicStatisticsResponseSchema,
  sdkSuccessfulResponseSchemas,
} from "./response-schemas";
import { AgentProtocolClient } from "./client";

type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  additionalProperties?: boolean | JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  oneOf?: JsonSchema[];
};

const documentedResponses = [
  ["/api/public/stats", "get", "200"],
  ["/api/public/dashboard", "get", "200"],
  ["/api/public/tasks/completed", "get", "200"],
  ["/api/tasks", "get", "200"],
  ["/api/tasks/{taskId}", "get", "200"],
  ["/api/chain/config", "get", "200"],
  ["/api/agents", "get", "200"],
  ["/api/agent/jobs/lease", "post", "200"],
  ["/api/agent/jobs/{jobId}/heartbeat", "post", "200"],
  ["/api/agent/jobs/{jobId}/complete", "post", "200"],
  ["/api/artifacts/uploads", "post", "201"],
  ["/api/artifacts/{artifactId}/finalize", "post", "200"],
  ["/api/artifacts/tasks/{taskId}/download", "post", "200"],
  ["/api/artifacts/tasks/{taskId}/contributions", "post", "200"],
  ["/api/agent/evaluations/{taskId}", "get", "200"],
  ["/api/agent/evaluations/{taskId}", "post", "201"],
  ["/api/evidence", "post", "201"],
] as const;

describe("production SDK successful response contracts", () => {
  it("accepts the runtime discovery, statistics and dashboard projections", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../public/.well-known/agentgrid.json", import.meta.url), "utf8"));
    expect(discoveryResponseSchema.parse(manifest)).toEqual(manifest);

    const now = new Date("2026-08-31T00:00:00.000Z");
    const statistics = publicTaskStatistics([], [], now);
    expect(publicStatisticsResponseSchema.parse(statistics)).toEqual(statistics);

    const dashboard = buildAiDashboard({
      config: {
        epochId: "epoch-1",
        epochRewardBudget: 1_000_000,
        epochRewardIssued: 0,
        minPublisherStake: 1_000,
        minAgentStake: 1_000,
        taskCreditTtlDays: 30,
        rewardCapRatio: 0.2,
        maintenanceDays: [7, 30, 90],
        maintenanceShares: [0.2, 0.2, 0.2],
        collaborationMultipliers: [1, 0.7, 0.4, 0.2, 0.1],
      },
      stats: { lockedStake: 0, activeTasks: 0, completedTasks: 0, onlineAgents: 0, rewardReserve: 0, issuedRewards: 0 },
      tasks: [],
      agents: [],
      rewards: [],
      economics: {
        grossTaskRewards: 0, agentPool: 0, daoVested: 0, sourceVested: 0,
        lifecycleConsumed: 0, rewardVaultRecycled: 0, burned: 0, securityReserved: 0,
        netDemand30d: { status: "UNAVAILABLE", reason: "External receipts missing." },
        netDemand90d: { status: "UNAVAILABLE", reason: "External receipts missing." },
      },
    }, now, "production");
    expect(publicDashboardResponseSchema.parse(dashboard)).toEqual(dashboard);
  });

  it("gives every production SDK HTTP workflow an explicit well-known entrypoint", () => {
    const manifest = discoveryResponseSchema.parse(JSON.parse(readFileSync(new URL("../../public/.well-known/agentgrid.json", import.meta.url), "utf8")));
    const expected: Record<string, readonly string[]> = {
      discovery: ["openapi"],
      publicStatistics: ["publicStatistics"],
      publicDashboard: ["publicAiDashboard"],
      chainConfig: ["chainConfig"],
      completedTasks: ["completedTasks"],
      listTasks: ["publicTasks"],
      listAgents: ["agentDirectory"],
      getTask: ["publicTask"],
      leaseJob: ["jobLease"],
      heartbeatJob: ["jobHeartbeat"],
      completeJob: ["jobCompletion"],
      uploadArtifact: ["artifactUpload", "artifactFinalize"],
      getArtifactForTesting: ["testerArtifactAccess"],
      getTeamContributions: ["teamContributionAccess"],
      getTaskEvaluation: ["assignedEvaluation"],
      submitSignedTaskEvaluation: ["assignedEvaluation"],
      submitSignedEvidence: ["signedTestEvidence"],
    };
    const methods = Object.getOwnPropertyNames(AgentProtocolClient.prototype)
      .filter((name) => name !== "constructor" && !["boundedJson", "request", "publicRequest", "requireAgentId"].includes(name));
    expect(Object.keys(expected).sort()).toEqual(methods.sort());
    for (const keys of Object.values(expected)) for (const key of keys) {
      expect(manifest[key as keyof typeof manifest], key).toBeTruthy();
    }
  });

  it("gives every production SDK HTTP operation a closed successful OpenAPI envelope", () => {
    const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8")) as {
      info: { version: string };
      paths: Record<string, Record<string, { responses: Record<string, { content?: { "application/json"?: { schema?: JsonSchema } } }> }>>;
      components: { schemas: Record<string, JsonSchema> };
    };
    expect(openapi.info.version).toBe("0.8.13");
    expect(openapi.components.schemas.TaskDefinition.properties?.collaborationPlan?.$ref).toBe("#/components/schemas/CollaborationPlan");
    expect(openapi.components.schemas.CollaborationPlan.additionalProperties).toBe(false);
    expect(openapi.components.schemas.CollaborationPlan.required).toEqual(expect.arrayContaining(["workPackages", "sharedInterfaces", "assemblyStrategy", "underfilledStrategy", "integrationChecks"]));
    expect(openapi.components.schemas.TeamContribution.required).toContain("slot");
    expect(Object.keys(sdkSuccessfulResponseSchemas)).toHaveLength(documentedResponses.length + 1);

    const resolve = (schema: JsonSchema): JsonSchema => {
      if (!schema.$ref) return schema;
      const name = schema.$ref.replace("#/components/schemas/", "");
      return openapi.components.schemas[name];
    };
    for (const [path, method, status] of documentedResponses) {
      const schema = openapi.paths[path]?.[method]?.responses[status]?.content?.["application/json"]?.schema;
      expect(schema, `${method.toUpperCase()} ${path} ${status}`).toBeTruthy();
      const resolved = resolve(schema!);
      const objectVariants = resolved.oneOf ? resolved.oneOf.map(resolve).filter((item) => item.type === "object") : [resolved];
      expect(objectVariants.length, `${method.toUpperCase()} ${path} object response`).toBeGreaterThan(0);
      for (const variant of objectVariants) {
        expect(variant.additionalProperties, `${method.toUpperCase()} ${path} closed response`).toBe(false);
      }
    }
  });
});
