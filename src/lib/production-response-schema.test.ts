import { describe, expect, it } from "vitest";
import { clarifyTaskSpecification } from "./task-spec-assistant";
import { assessTaskDefinition, taskDefinitionHash, taskDefinitionReviewBindingHash } from "./task-definition";
import {
  clearedTaskCommitmentTransactionResponseSchema,
  createTaskCommitmentResponseSchema,
  hiddenTestContentResponseSchema,
  hiddenTestFinalizeResponseSchema,
  hiddenTestUploadResponseSchema,
  isoTimestamp,
  revokeAgentCredentialResponseSchema,
  rotateAgentCredentialResponseSchema,
  pendingTaskCommitmentResponseSchema,
  taskCommitmentTransactionResponseSchema,
  taskSpecAssistantResponseSchema,
} from "./production-response-schema";

const uuid = "f59d7736-338b-4a25-b844-4e1f4a79ba24";
const hash = `0x${"a".repeat(64)}`;

describe("production response schemas", () => {
  it("closes task-definition review output at every nested boundary", async () => {
    const draft = {
      publisher: "0x0000000000000000000000000000000000000001",
      title: "Deliver a verifiable support workflow",
      businessOutcome: "Support operators receive a complete workflow with reproducible acceptance evidence.",
      category: "Development",
      executionMode: "COLLABORATION" as const,
      maxExecutors: 2,
      targetUsers: "Support operations owners",
      deliverables: ["A runnable support workflow package"],
      constraints: ["Independent testers can reproduce every result"],
      outOfScope: ["Post-acceptance operational customization"],
      assumptions: [],
      criteria: [],
    };
    const result = await clarifyTaskSpecification(draft);
    const assessment = assessTaskDefinition(result.recommendation);
    const response = {
      ...result,
      assessment,
      definitionHash: taskDefinitionHash(result.recommendation),
      reviewedTaskHash: taskDefinitionReviewBindingHash({ title: draft.title, businessOutcome: draft.businessOutcome, category: draft.category, executionMode: draft.executionMode, maxExecutors: draft.maxExecutors, completionDefinition: result.recommendation }),
      definitionReview: null,
    };
    expect(taskSpecAssistantResponseSchema.parse(response)).toEqual(response);
    expect(() => taskSpecAssistantResponseSchema.parse({ ...response, unexpected: true })).toThrow();
    expect(() => taskSpecAssistantResponseSchema.parse({ ...response, reviews: [{ ...response.reviews[0], review: { ...response.reviews[0].review, unexpected: true } }, response.reviews[1]] })).toThrow();
  });

  it("normalizes database timestamps and closes commitment recovery output", () => {
    expect(isoTimestamp("2026-09-01 01:23:45.123+00")).toBe("2026-09-01T01:23:45.123Z");
    expect(pendingTaskCommitmentResponseSchema.parse({ pending: null })).toEqual({ pending: null });
    const pending = {
      commitmentId: uuid, positionId: "12", specHash: hash, requestedReward: "2500",
      maxExecutors: 2, executionMode: "COLLABORATION" as const, requiredTesterCapabilities: 3,
      broadcastReady: false, retryAfter: "2026-09-01T01:25:45.123Z",
    };
    expect(pendingTaskCommitmentResponseSchema.parse({ pending })).toEqual({ pending });
    expect(() => pendingTaskCommitmentResponseSchema.parse({ pending: { ...pending, transactionHash: hash } })).toThrow();
  });

  it("closes commitment and hidden-test mutation responses", () => {
    const commitment = { id: uuid, publisher: "0xpublisher", specHash: hash, status: "DRAFT", createdAt: "2026-09-01T01:23:45.123Z", requestedReward: 2500 };
    expect(createTaskCommitmentResponseSchema.parse(commitment)).toEqual(commitment);
    expect(taskCommitmentTransactionResponseSchema.parse({ commitmentId: uuid, transactionHash: hash })).toBeTruthy();
    expect(clearedTaskCommitmentTransactionResponseSchema.parse({ id: uuid, cleared: true })).toBeTruthy();
    expect(hiddenTestUploadResponseSchema.parse({ id: uuid })).toBeTruthy();
    expect(hiddenTestContentResponseSchema.parse({ uploaded: true })).toBeTruthy();
    expect(hiddenTestFinalizeResponseSchema.parse({ id: uuid, plaintextSha256: "b".repeat(64), sizeBytes: 128, contentType: "application/gzip" })).toBeTruthy();
    expect(() => hiddenTestContentResponseSchema.parse({ uploaded: true, bytes: 128 })).toThrow();
  });

  it("closes one-time credential rotation and revocation output", () => {
    const agent = {
      id: "agent-builder-01", name: "Builder", owner: "0xowner", role: "EXECUTOR" as const,
      capabilities: ["AUTOMATED_TEST"], endpoint: "https://agent.example.com/jobs",
      scopes: ["tasks:claim" as const], revokedAt: null, stakePositionId: "7", stake: 500,
      reputation: 50, completedTasks: 0, online: true,
    };
    const rotated = { agent, apiKey: `amp_${"a".repeat(43)}` };
    expect(rotateAgentCredentialResponseSchema.parse(rotated)).toEqual(rotated);
    const revokedAt = "2026-09-01T01:23:45.123Z";
    expect(revokeAgentCredentialResponseSchema.parse({ agent: { ...agent, revokedAt, online: false }, revokedAt })).toBeTruthy();
    expect(() => rotateAgentCredentialResponseSchema.parse({ ...rotated, oldApiKey: "secret" })).toThrow();
  });
});
