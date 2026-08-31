import { describe, expect, it } from "vitest";
import { parsePendingTaskEvaluation } from "./pending-task-evaluation";

const pending = {
  commitmentId: "3a410350-0af5-4ca0-9125-af6765c9a237",
  positionId: "12",
  specHash: `0x${"ab".repeat(32)}`,
  requestedReward: "2500",
  maxExecutors: 3,
  executionMode: "COMPETITION" as const,
  requiredTesterCapabilities: 10,
};

describe("pending task evaluation", () => {
  it("restores a sealed commitment before and after broadcast", () => {
    expect(parsePendingTaskEvaluation(pending)).toEqual(pending);
    const broadcast = { ...pending, transactionHash: `0x${"cd".repeat(32)}` };
    expect(parsePendingTaskEvaluation(broadcast)).toEqual(broadcast);
  });

  it("rejects corrupt or expanded local state", () => {
    expect(() => parsePendingTaskEvaluation({ ...pending, commitmentId: "not-a-uuid" })).toThrow();
    expect(() => parsePendingTaskEvaluation({ ...pending, positionId: "-1" })).toThrow();
    expect(() => parsePendingTaskEvaluation({ ...pending, transactionHash: "0xbroken" })).toThrow();
    expect(() => parsePendingTaskEvaluation({ ...pending, publisher: "0xattacker" })).toThrow();
  });
});
