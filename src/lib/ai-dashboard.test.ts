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
    expect(dashboard.schemaVersion).toBe("2.7");
    expect(dashboard.selectionPolicy).toMatchObject({
      positiveChangesAfterRequest: "IGNORED_FOR_FROZEN_DRAW",
      mainnetRequirement: "VRF_REQUIRED",
      fairnessFloorTickets: 1_000,
      scalability: {
        status: "LOCAL_GOVERNED_GAS_GATE_PASS",
        currentSelectionComplexity: "TASK_PATH_BOUNDED_PAGINATED_FENWICK",
        poolPrimitive: {
          boundedBuildPageMax: 64,
          taskRegistryIntegration: "INTEGRATED",
          exhaustedPoolRecovery: "OBJECTIVE_EXHAUSTION_THEN_REGISTRY_VERSION_ADVANCE",
          observedEntropyResampling: "FORBIDDEN",
          partialProofContinuationAfterBlockhashExpiry: true,
        },
        randomWindowAccepted: false,
        governedGasRegistrySize: 65_536,
        governedTransactionGasLimit: 30_000_000,
        governedGasRegression: "PASS",
      },
      liveness: {
        coordinator: "OPTIONAL_AUTOMATION_NO_EXCLUSIVE_AUTHORITY",
        callerSelectionAuthority: "NONE",
      },
      qualityGain: {
        minimumTaskRewardAgt: 10,
        maximumPositiveGainsPerRelationshipEpoch: 1,
        independentPublisherRelationshipsForPriority: 3,
        commonControlBoundary: "EXTERNAL_SYBIL_ATTESTATION_REQUIRED",
      },
      rehabilitation: {
        minimumStakeAgt: 500,
        quorum: 2,
        falseAppealSlashBps: [500, 1_500, 3_000],
        restoredQualityBps: 2_500,
      },
    });
    expect(dashboard.economics).toMatchObject({ agentPool: 190, burned: 3, netDemand30d: { status: "UNAVAILABLE" } });
    expect(dashboard.revenuePolicy).toMatchObject({
      accountingMode: "LOCAL_SIMULATION_ONLY",
      realizedRevenueStatus: "UNAVAILABLE",
      advertisingAllocationBps: { platformCash: 5_000, rewardVaultBuyback: 4_000, burnBuyback: 1_000 },
      sponsorshipAllocationBps: { sponsoredTaskPoolBuyback: 7_000, platformCash: 1_000 },
      protocolInfluence: { evaluatorSelection: "NONE", validatorSelection: "NONE", qualityRanking: "NONE" },
    });
    expect(dashboard.promotionPolicy).toMatchObject({ signingVersion: "AgentGrid Task Promotion V1", rankingEffect: "DISPLAY_ORDER_ONLY", protocolInfluence: "NONE" });
    expect(dashboard.paidCapacityPolicy).toMatchObject({
      implementationStatus: "DOMAIN_MODEL_ONLY", available: false, purchaseEndpoint: null,
      enforcementContract: "competitionSlotPassRegistry", enforcementExposure: "INTERNAL_COMMERCIAL_ENFORCEMENT_ONLY", participantPurchaseAction: false,
      activation: "PRE_PUBLICATION_ONLY",
      entitlements: {
        extraCompetitionSlots: { includedCompetitionSlots: 2, maximumPaidExtraSlots: 30, maximumResultingExecutors: 32, effect: "EXECUTOR_CAPACITY_ONLY", executorRecipientWeightsMayChange: true, rewardPoolAffected: false, requiredEnforcement: "ONCHAIN_COMPETITION_SLOT_PASS_REGISTRY" },
        priorityScheduling: { maximumPrioritySlots: 32, eligibleJobKinds: ["EXECUTE_TASK"], effect: "EXECUTOR_GENERAL_QUEUE_ORDER_ONLY", fairnessEnforcement: "APPLICATION_FAIR_QUEUE_3_TO_1", paidToOrganicDispatchRatio: "3:1", rewardPoolAffected: false },
      },
      unaffected: { evaluationJobs: "NONE", verificationJobs: "NONE", arbitrationJobs: "NONE", deadlineAndTimeoutJobs: "NONE", evaluatorSelection: "NONE", validatorSelection: "NONE", arbitratorSelection: "NONE", qualityGates: "NONE", challengeRightsAndWindows: "NONE", acceptanceCriteriaAndDeadlines: "NONE" },
    });
    const dashboardPage = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
    expect(dashboardPage).toContain("dashboard.promotionPolicy");
    expect(dashboardPage).toContain("task.promotion");
    expect(dashboardPage).toContain("sponsored-badge");
    expect(dashboardPage).toContain("dashboard.paidCapacityPolicy");
    expect(dashboardPage).toContain("DOMAIN_MODEL_ONLY");
    expect(dashboardPage).not.toContain("purchasePaidCapacity");
    expect(dashboard.onChainActions).toHaveLength(46);
    expect(dashboard.onChainActions.some((action) => action.contract === "competitionSlotPassRegistry")).toBe(false);
    for (const id of ["evict-inactive-executor", "request-validator-draw", "finalize-validator-draw", "request-maintenance-panel"]) {
      expect(dashboard.onChainActions.find((action) => action.id === id)?.role).toBe("ANYONE");
    }
    expect(dashboard.onChainActionExclusions).toHaveLength(62);
    expect(dashboard.onChainActions.find((action) => action.id === "open-verification-challenge")).toMatchObject({
      contract: "verificationArbitrationCourt", signature: "openChallenge(uint256,address,bytes32)", role: "ELIGIBLE_CHALLENGER",
    });
    expect(dashboardPage).toContain("dashboard.onChainActions");
    expect(dashboardPage).toContain("dashboard.onChainActionExclusions");
    expect(dashboardPage).toContain("dashboard.selectionPolicy.liveness.permissionlessActions.length");
    expect(dashboard.generatedAt).toBe("2026-08-31T00:00:00.000Z");
    expect(dashboard.actionContracts.find((action) => action.id === "lease-job")?.authentication).toContain("x-agent-id");
    expect(serialized).not.toContain("Private draft");
    expect(serialized).not.toContain("Rejected private task");
    expect(dashboard.trustBoundary.redacted).toContain("hidden tests");
    const openapi = JSON.parse(readFileSync(new URL("../../public/openapi.json", import.meta.url), "utf8")) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: { schemas: { AiDashboard: {
        required: string[];
        properties: {
          revenuePolicy: { properties: { realizedRevenueStatus: { const: string }; protocolInfluence: { properties: Record<string, { const: string }> } } };
          paidCapacityPolicy: { properties: {
            implementationStatus: { const: string }; available: { const: boolean }; enforcementContract: { const: string };
            enforcementExposure: { const: string }; participantPurchaseAction: { const: boolean };
            entitlements: { properties: {
              extraCompetitionSlots: { properties: { includedCompetitionSlots: { const: number }; maximumPaidExtraSlots: { const: number }; effect: { const: string }; rewardPoolAffected: { const: boolean } } };
              priorityScheduling: { properties: { eligibleJobKinds: { prefixItems: Array<{ const: string }> }; fairnessEnforcement: { const: string }; effect: { const: string } } };
            } };
            unaffected: { properties: Record<string, { const: string }> };
          } };
          selectionPolicy: { required: string[]; properties: {
            scalability: { properties: { status: { const: string }; randomWindowAccepted: { const: boolean } } };
            liveness: { properties: { coordinator: { const: string }; callerSelectionAuthority: { const: string }; permissionlessActions: { minItems: number; maxItems: number } } };
          } };
          actionContracts: { items: { properties: { method: { enum: string[] } } } };
          onChainActions: { minItems: number; maxItems: number; items: { properties: { contract: { enum: string[] }; availability: { enum: string[] } } } };
          onChainActionExclusions: { minItems: number; maxItems: number; items: { properties: { classification: { enum: string[] } } } };
        };
      } } };
    };
    expect(openapi.components.schemas.AiDashboard.required).toContain("revenuePolicy");
    expect(openapi.components.schemas.AiDashboard.required).toContain("paidCapacityPolicy");
    expect(openapi.components.schemas.AiDashboard.properties.paidCapacityPolicy.properties).toMatchObject({
      implementationStatus: { const: "DOMAIN_MODEL_ONLY" }, available: { const: false }, enforcementContract: { const: "competitionSlotPassRegistry" },
      enforcementExposure: { const: "INTERNAL_COMMERCIAL_ENFORCEMENT_ONLY" }, participantPurchaseAction: { const: false },
      entitlements: { properties: {
        extraCompetitionSlots: { properties: { includedCompetitionSlots: { const: 2 }, maximumPaidExtraSlots: { const: 30 }, effect: { const: "EXECUTOR_CAPACITY_ONLY" }, rewardPoolAffected: { const: false } } },
        priorityScheduling: { properties: { eligibleJobKinds: { prefixItems: [{ const: "EXECUTE_TASK" }] }, fairnessEnforcement: { const: "APPLICATION_FAIR_QUEUE_3_TO_1" }, effect: { const: "EXECUTOR_GENERAL_QUEUE_ORDER_ONLY" } } },
      } },
    });
    expect(new Set(Object.values(openapi.components.schemas.AiDashboard.properties.paidCapacityPolicy.properties.unaffected.properties).map((item) => item.const))).toEqual(new Set(["NONE"]));
    expect(openapi.components.schemas.AiDashboard.properties.selectionPolicy.required).toContain("liveness");
    expect(openapi.components.schemas.AiDashboard.properties.selectionPolicy.required).toContain("scalability");
    expect(openapi.components.schemas.AiDashboard.properties.selectionPolicy.properties.scalability.properties).toMatchObject({
      status: { const: "LOCAL_GOVERNED_GAS_GATE_PASS" },
      governedGasRegistrySize: { const: 65_536 },
      governedTransactionGasLimit: { const: 30_000_000 },
      governedGasRegression: { const: "PASS" },
      randomWindowAccepted: { const: false },
    });
    expect(openapi.components.schemas.AiDashboard.properties.selectionPolicy.properties.liveness.properties).toMatchObject({
      coordinator: { const: "OPTIONAL_AUTOMATION_NO_EXCLUSIVE_AUTHORITY" },
      callerSelectionAuthority: { const: "NONE" },
      permissionlessActions: { minItems: 13, maxItems: 13 },
    });
    expect(openapi.components.schemas.AiDashboard.properties.revenuePolicy.properties.realizedRevenueStatus.const).toBe("UNAVAILABLE");
    expect(new Set(Object.values(openapi.components.schemas.AiDashboard.properties.revenuePolicy.properties.protocolInfluence.properties).map((item) => item.const))).toEqual(new Set(["NONE"]));
    const documentedMethods = openapi.components.schemas.AiDashboard.properties.actionContracts.items.properties.method.enum;
    expect(documentedMethods).toEqual(expect.arrayContaining([...new Set(dashboard.actionContracts.map((action) => action.method))]));
    expect(openapi.components.schemas.AiDashboard.properties.onChainActions).toMatchObject({ minItems: 46, maxItems: 46 });
    expect(openapi.components.schemas.AiDashboard.properties.onChainActionExclusions).toMatchObject({ minItems: 62, maxItems: 62 });
    expect(openapi.components.schemas.AiDashboard.properties.onChainActionExclusions.items.properties.classification.enum).toEqual([
      "GOVERNANCE_ONLY", "PROTOCOL_INTERNAL", "TOKEN_TRANSFER_OUTSIDE_AGENTGRID_WORKFLOW",
    ]);
    expect(openapi.components.schemas.AiDashboard.properties.onChainActions.items.properties.contract.enum).toEqual(expect.arrayContaining(["taskRegistry", "verificationArbitrationCourt", "disputeResolver", "competitionSlotPassRegistry"]));
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
    expect(manifest.schemaVersion).toBe("1.2");
    for (const endpoint of Object.values(manifest).filter((value): value is string => typeof value === "string" && value.startsWith("/api/"))) {
      expect(openapi.paths[endpoint], `${endpoint} must be described by OpenAPI`).toBeTruthy();
    }
  });
});
