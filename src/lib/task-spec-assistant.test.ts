import { afterEach, describe, expect, it, vi } from "vitest";
import { clarifyTaskSpecification, deterministicClarificationReview, requiredExternalAiReviewBlockers, taskSpecAiConfigurationReady } from "./task-spec-assistant";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SPEC_ASSISTANT_AI_BASE_URL;
  delete process.env.SPEC_ASSISTANT_AI_ALLOWED_ORIGINS;
  delete process.env.SPEC_ASSISTANT_AI_MODELS;
  delete process.env.SPEC_ASSISTANT_AI_API_KEY;
});

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

  it("requires two allowlisted external AI roles and file custody when enabled", () => {
    const configured = {
      SPEC_ASSISTANT_AI_BASE_URL: "https://ai.example/v1", SPEC_ASSISTANT_AI_ALLOWED_ORIGINS: "https://ai.example",
      SPEC_ASSISTANT_AI_MODELS: "requirements-model,critic-model", SPEC_ASSISTANT_AI_API_KEY: "test-key", REQUIRE_FILE_SECRETS: "false",
    };
    expect(taskSpecAiConfigurationReady(configured)).toBe(true);
    expect(taskSpecAiConfigurationReady({ ...configured, SPEC_ASSISTANT_AI_MODELS: "requirements-model" })).toBe(false);
    expect(taskSpecAiConfigurationReady({ ...configured, REQUIRE_FILE_SECRETS: "true" })).toBe(false);
    expect(taskSpecAiConfigurationReady({ ...configured, SPEC_ASSISTANT_AI_ALLOWED_ORIGINS: "https://other.example" })).toBe(false);
  });

  it("does not issue a production-ready review when either external AI role is missing", () => {
    const writer = deterministicClarificationReview({
      publisher: "publisher-1", title: "Build settlement monitor", businessOutcome: "Alert operations before a failed settlement breaches the service-level objective.", category: "Automation",
      targetUsers: "Settlement operations analysts", deliverables: ["Runnable monitor service"], constraints: ["No outbound network in tests"], outOfScope: ["Mainnet deployment"], assumptions: [],
      criteria: [
        { description: "Hidden scenarios pass", verificationMethod: "Run sealed scenarios", evidenceRequired: "Signed log", passCondition: "All scenarios pass", required: true },
        { description: "Alert latency is below 500ms", verificationMethod: "Replay fixed events", evidenceRequired: "Latency trace", passCondition: "p95 is less than 500ms", required: true },
      ],
    });
    const reviews = [{ role: "REQUIREMENTS_WRITER" as const, provider: "https://ai.example", model: "writer", reportHash: `0x${"1".repeat(64)}` as `0x${string}`, review: writer }];
    expect(requiredExternalAiReviewBlockers(reviews, false)).toEqual([]);
    expect(requiredExternalAiReviewBlockers(reviews, true)).toEqual(["EXTERNAL_AI_VALIDATION_CRITIC_MISSING"]);
  });

  it("gives the validation critic the exact proposed collaboration plan", async () => {
    const draft = {
      publisher: "publisher-1", title: "Build settlement monitor", businessOutcome: "Alert operations before a failed settlement breaches the service-level objective.", category: "Automation",
      executionMode: "COLLABORATION" as const, maxExecutors: 2,
      targetUsers: "Settlement operations analysts", deliverables: ["Runnable monitor service"], constraints: ["No outbound network in tests"], outOfScope: ["Mainnet deployment"], assumptions: [],
      criteria: [
        { description: "Hidden scenarios pass", verificationMethod: "Run sealed scenarios", evidenceRequired: "Signed log", passCondition: "All scenarios must pass", verificationType: "AUTOMATED_TEST" as const, required: true },
        { description: "Alert latency is below 500ms", verificationMethod: "Replay fixed events", evidenceRequired: "Latency trace", passCondition: "p95 must be less than 500ms", verificationType: "AUTOMATED_TEST" as const, required: true },
      ],
    };
    const responseReview = deterministicClarificationReview(draft);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseReview) } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.SPEC_ASSISTANT_AI_BASE_URL = "https://ai.example/v1";
    process.env.SPEC_ASSISTANT_AI_ALLOWED_ORIGINS = "https://ai.example";
    process.env.SPEC_ASSISTANT_AI_MODELS = "writer-model,critic-model";
    process.env.SPEC_ASSISTANT_AI_API_KEY = "test-key";

    const result = await clarifyTaskSpecification(draft);
    expect(result.recommendation.collaborationPlan?.workPackages).toHaveLength(2);
    const criticRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { messages: Array<{ content: string }> };
    const criticPayload = JSON.parse(criticRequest.messages[1].content) as { proposedDefinition: { collaborationPlan: { workPackages: unknown[] } } };
    expect(criticPayload.proposedDefinition.collaborationPlan.workPackages).toHaveLength(2);
  });
});
