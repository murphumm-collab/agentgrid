import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aiDashboardActionContracts, buildAiDashboard, type AiDashboardSource } from "./ai-dashboard";
import { seedDatabase } from "./store";

function source(): AiDashboardSource {
  const database = seedDatabase();
  database.tasks.push(
    { ...database.tasks[0], id: "private-evaluation", state: "EVALUATING", title: "Private draft" },
    { ...database.tasks[0], id: "rejected-task", state: "REJECTED", title: "Rejected private task" },
  );
  return {
    config: database.config,
    stats: { lockedStake: 1_000, activeTasks: 1, completedTasks: 0, onlineAgents: 3, rewardReserve: 100_000, issuedRewards: 0 },
    tasks: database.tasks,
    agents: database.agents,
    rewards: database.rewards,
    economics: {
      grossTaskRewards: 200, agentPool: 190, daoVested: 7, sourceVested: 4.25,
      lifecycleConsumed: 15, rewardVaultRecycled: 5.25, burned: 3, securityReserved: 1.5,
      netDemand30d: { status: "UNAVAILABLE", reason: "External receipts missing." },
      netDemand90d: { status: "UNAVAILABLE", reason: "External receipts missing." },
    },
  };
}

describe("AI dashboard", () => {
  it("publishes deterministic action metadata without private task states", () => {
    const dashboard = buildAiDashboard(source(), new Date("2026-08-31T00:00:00.000Z"));
    const serialized = JSON.stringify(dashboard);
    expect(dashboard.schemaVersion).toBe("1.5");
    expect(dashboard.selectionPolicy).toMatchObject({
      positiveChangesAfterRequest: "IGNORED_FOR_FROZEN_DRAW",
      mainnetRequirement: "VRF_REQUIRED",
      fairnessFloorTickets: 1_000,
      rehabilitation: {
        minimumStakeAgt: 500,
        quorum: 2,
        falseAppealSlashBps: [500, 1_500, 3_000],
        restoredQualityBps: 2_500,
      },
    });
    expect(dashboard.economics).toMatchObject({ agentPool: 190, burned: 3, netDemand30d: { status: "UNAVAILABLE" } });
    expect(dashboard.generatedAt).toBe("2026-08-31T00:00:00.000Z");
    expect(dashboard.actionContracts.find((action) => action.id === "lease-job")?.authentication).toContain("x-agent-id");
    expect(serialized).not.toContain("Private draft");
    expect(serialized).not.toContain("Rejected private task");
    expect(dashboard.trustBoundary.redacted).toContain("hidden tests");
    const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8")) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: { schemas: { AiDashboard: { properties: { actionContracts: { items: { properties: { method: { enum: string[] } } } } } } } };
    };
    const documentedMethods = openapi.components.schemas.AiDashboard.properties.actionContracts.items.properties.method.enum;
    expect(documentedMethods).toEqual(expect.arrayContaining([...new Set(dashboard.actionContracts.map((action) => action.method))]));
    for (const action of dashboard.actionContracts) {
      expect(openapi.paths[action.endpoint]?.[action.method.toLowerCase()]?.operationId).toBe(action.operationId);
    }
    const documentedOperations = Object.entries(openapi.paths).flatMap(([endpoint, methods]) =>
      Object.entries(methods).flatMap(([method, operation]) => operation.operationId
        ? [{ endpoint, method: method.toUpperCase(), operationId: operation.operationId }]
        : []));
    expect(new Set(aiDashboardActionContracts.map((action) => action.operationId)).size).toBe(aiDashboardActionContracts.length);
    const byOperationId = (left: { operationId: string }, right: { operationId: string }) => left.operationId.localeCompare(right.operationId);
    expect(dashboard.actionContracts.map(({ endpoint, method, operationId }) => ({ endpoint, method, operationId })).sort(byOperationId))
      .toEqual(documentedOperations.sort(byOperationId));
    const manifest = JSON.parse(readFileSync(new URL("../../public/.well-known/agentgrid.json", import.meta.url), "utf8")) as Record<string, unknown>;
    expect(manifest.schemaVersion).toBe("1.1");
    for (const endpoint of Object.values(manifest).filter((value): value is string => typeof value === "string" && value.startsWith("/api/"))) {
      expect(openapi.paths[endpoint], `${endpoint} must be described by OpenAPI`).toBeTruthy();
    }
  });
});
