import { describe, expect, it } from "vitest";
import { operationalAlerts } from "./operational-alerts";

const queue = { executorQueued: 0, testerQueued: 0, evaluatorQueued: 0, coordinatorQueued: 0 };

describe("operational alert thresholds", () => {
  it("reports a healthy empty pilot", () => {
    expect(operationalAlerts({}, queue)).toEqual([]);
  });

  it("detects queue and durable outbox stalls", () => {
    expect(operationalAlerts(
      { pendingOutbox: 3, pendingOutboxOldestSeconds: 301 },
      { executorQueued: 30, testerQueued: 30, evaluatorQueued: 20, coordinatorQueued: 20 },
    )).toEqual(["QUEUE_BACKLOG_HIGH", "CHAIN_OUTBOX_STALLED"]);
  });

  it("detects notification backlog independently", () => {
    expect(operationalAlerts({ unreadNotifications: 1_000 }, queue)).toEqual(["NOTIFICATION_BACKLOG_HIGH"]);
  });

  it("detects evaluations whose Task Credit still needs release", () => {
    expect(operationalAlerts({ expiredEvaluations: 1 }, queue)).toEqual(["TASK_EVALUATION_EXPIRY_BACKLOG"]);
  });

  it("detects rejected low-value, self-dealing and repeat relationship quality gains", () => {
    expect(operationalAlerts({
      qualityLowValueIgnored1h: 1,
      qualitySelfDealingIgnored1h: 2,
      qualityRelationshipCapIgnored1h: 3,
    }, queue)).toEqual([
      "QUALITY_LOW_VALUE_GAIN_ATTEMPT",
      "QUALITY_SELF_DEALING_ATTEMPT",
      "QUALITY_RELATIONSHIP_FARMING_ATTEMPT",
    ]);
  });

  it("detects a missing or stale confirmed-chain indexer", () => {
    expect(operationalAlerts({ chainCursorAgeSeconds: null }, queue)).toEqual(["CHAIN_INDEXER_NOT_STARTED"]);
    expect(operationalAlerts({ chainCursorAgeSeconds: 121 }, queue)).toEqual(["CHAIN_INDEXER_STALLED"]);
  });
});
