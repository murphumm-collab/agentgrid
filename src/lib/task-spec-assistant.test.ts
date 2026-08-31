import { describe, expect, it } from "vitest";
import { deterministicClarificationReview } from "./task-spec-assistant";

describe("task specification assistant", () => {
  it("asks blocking questions instead of inventing missing completion rules", () => {
    const review = deterministicClarificationReview({
      publisher: "publisher-1", title: "Research settlement providers", businessOutcome: "Select a provider for a regulated stablecoin settlement launch decision.", category: "Research",
      targetUsers: "", deliverables: [], constraints: [], outOfScope: [], assumptions: [], criteria: [],
    });
    expect(review.clarifyingQuestions.filter((item) => item.blocking).map((item) => item.id)).toEqual(["target-users", "deliverables", "constraints", "out-of-scope", "criteria"]);
    expect(review.suggestedCriteria).toHaveLength(2);
  });

  it("preserves supplied verifier methods and pass conditions", () => {
    const review = deterministicClarificationReview({
      publisher: "publisher-1", title: "Build settlement monitor", businessOutcome: "Alert operations before a failed settlement breaches the service-level objective.", category: "Automation",
      targetUsers: "Settlement operations analysts", deliverables: ["Runnable monitor service"], constraints: ["No outbound network in tests"], outOfScope: ["Mainnet deployment"], assumptions: [],
      criteria: [
        { description: "Hidden scenarios pass", verificationMethod: "Run sealed scenarios", evidenceRequired: "Signed log", passCondition: "All scenarios pass", required: true },
        { description: "Alert latency is below 500ms", verificationMethod: "Replay fixed events", evidenceRequired: "Latency trace", passCondition: "p95 is less than 500ms", required: true },
      ],
    });
    expect(review.clarifyingQuestions).toEqual([]);
    expect(review.suggestedCriteria[1].passCondition).toBe("p95 is less than 500ms");
  });
});
