import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizeExtraCompetitionSlots,
  authorizePriorityScheduling,
  assertPrioritySlotsFitTask,
  extraCompetitionSlotLimit,
  includedCompetitionSlots,
  paidCapacityEntitlementMessage,
  paidCapacityEntitlementSchema,
  paidCapacityIsolationPolicy,
  prioritySchedulingSlotLimit,
  verifyPaidCapacityEntitlementSignature,
  type ExtraCompetitionSlotsEntitlement,
  type PrioritySchedulingEntitlement,
} from "./paid-capacity-entitlement";

const issuer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const publisher = "0x2222222222222222222222222222222222222222";
const taskRegistry = "0x3333333333333333333333333333333333333333";
const receiptHash = `sha256:${"44".repeat(32)}`;
const specHash = `0x${"77".repeat(32)}`;

const common = {
  version: 1 as const,
  entitlementId: "11111111-1111-4111-8111-111111111111",
  chainId: 97 as const,
  taskRegistry,
  publisher,
  issuer: issuer.address,
  receipt: {
    processor: "agentgrid-billing",
    receiptId: "receipt:commercial:0001",
    receiptHash,
    amountAtomic: "25000000",
    settlementAsset: "USDC" as const,
    paidAt: "2026-09-02T01:00:00.000Z",
  },
  issuedAt: "2026-09-02T01:01:00.000Z",
  startsAt: "2026-09-02T01:02:00.000Z",
  expiresAt: "2026-09-09T01:02:00.000Z",
  isolation: paidCapacityIsolationPolicy,
  definitionReviewId: "22222222-2222-4222-8222-222222222222",
  specHash,
};

const extra: ExtraCompetitionSlotsEntitlement = {
  ...common,
  kind: "EXTRA_COMPETITION_SLOTS",
  effect: "EXECUTOR_CAPACITY_ONLY",
  executorRecipientWeightsMayChange: true,
  includedCompetitionSlots,
  paidExtraSlots: 3,
  resultingMaxExecutors: 5,
};

const priority: PrioritySchedulingEntitlement = {
  ...common,
  entitlementId: "33333333-3333-4333-8333-333333333333",
  receipt: { ...common.receipt, receiptId: "receipt:commercial:0002", receiptHash: `sha256:${"55".repeat(32)}` },
  kind: "PRIORITY_SCHEDULING",
  effect: "EXECUTOR_GENERAL_QUEUE_ORDER_ONLY",
  executorRecipientWeightsMayChange: false,
  prioritySlots: 4,
};

describe("paid capacity entitlement", () => {
  it("creates deterministic publisher, registry, receipt, window and review-bound signing material", async () => {
    const commitment = paidCapacityEntitlementMessage(extra);
    const repeated = paidCapacityEntitlementMessage(JSON.parse(JSON.stringify(extra)));
    expect(commitment.entitlementHash).toBe(repeated.entitlementHash);
    expect(commitment.message).toContain(`TaskRegistry: ${taskRegistry}`);
    expect(commitment.message).toContain(`Publisher: ${publisher}`);
    expect(commitment.message).toContain(`Definition review: ${extra.definitionReviewId}`);
    expect(commitment.message).toContain(`Receipt: ${receiptHash}`);
    expect(commitment.message).toContain("Settlement asset: USDC");
    expect(commitment.message).toContain("Amount atomic: 25000000");
    expect(commitment.message).toContain(`Spec: ${specHash}`);
    expect(commitment.message).toContain("Paid extra slots: 3");

    const signature = await issuer.signMessage({ message: commitment.message });
    await expect(verifyPaidCapacityEntitlementSignature({ entitlement: extra, signature, expectedIssuer: issuer.address }))
      .resolves.toMatchObject({ signer: issuer.address, entitlementHash: commitment.entitlementHash });
    await expect(verifyPaidCapacityEntitlementSignature({ entitlement: { ...extra, publisher: "0x4444444444444444444444444444444444444444" }, signature, expectedIssuer: issuer.address }))
      .rejects.toThrow("PAID_CAPACITY_SIGNATURE_INVALID");
  });

  it("authorizes exact extra competition capacity only before publication", () => {
    const review = {
      id: extra.definitionReviewId,
      publisher,
      chainId: 97 as const,
      taskRegistry,
      executionMode: "COMPETITION" as const,
      specHash,
      publishedTaskId: null,
    };
    expect(authorizeExtraCompetitionSlots({ entitlement: extra, review, now: new Date("2026-09-03T00:00:00.000Z") })).toEqual({
      kind: "EXTRA_COMPETITION_SLOTS",
      definitionReviewId: extra.definitionReviewId,
      additionalSlots: 3,
      resultingMaxExecutors: 5,
      effect: "EXECUTOR_CAPACITY_ONLY",
      executorRecipientWeightsMayChange: true,
      rewardPoolAffected: false,
      requiredEnforcement: "ONCHAIN_COMPETITION_SLOT_PASS_REGISTRY",
      isolation: paidCapacityIsolationPolicy,
    });
    expect(() => authorizeExtraCompetitionSlots({ entitlement: extra, review: { ...review, publishedTaskId: "42" }, now: new Date("2026-09-03T00:00:00.000Z") }))
      .toThrow("PAID_CAPACITY_REVIEW_ALREADY_PUBLISHED");
    expect(() => authorizeExtraCompetitionSlots({ entitlement: extra, review: { ...review, executionMode: "COLLABORATION" }, now: new Date("2026-09-03T00:00:00.000Z") }))
      .toThrow("PAID_CAPACITY_COMPETITION_ONLY");
    expect(() => authorizeExtraCompetitionSlots({ entitlement: extra, review: { ...review, specHash: `0x${"88".repeat(32)}` }, now: new Date("2026-09-03T00:00:00.000Z") }))
      .toThrow("PAID_CAPACITY_SPEC_MISMATCH");
  });

  it("authorizes only pre-publication general-executor queue priority", () => {
    const review = { id: priority.definitionReviewId, publisher, chainId: 97 as const, taskRegistry, specHash, publishedTaskId: null };
    const result = authorizePriorityScheduling({
      entitlement: priority,
      review,
      now: new Date("2026-09-03T00:00:00.000Z"),
    });
    expect(result).toEqual({
      kind: "PRIORITY_SCHEDULING",
      definitionReviewId: priority.definitionReviewId,
      prioritySlots: 4,
      effect: "EXECUTOR_GENERAL_QUEUE_ORDER_ONLY",
      executorRecipientWeightsMayChange: false,
      rewardPoolAffected: false,
      requiredEnforcement: "APPLICATION_FAIR_QUEUE_3_TO_1",
      isolation: paidCapacityIsolationPolicy,
    });
    expect(() => authorizePriorityScheduling({ entitlement: priority, review: { ...review, publishedTaskId: "42" }, now: new Date("2026-09-03T00:00:00.000Z") }))
      .toThrow("PAID_CAPACITY_REVIEW_ALREADY_PUBLISHED");
  });

  it("enforces strict type-specific fields, arithmetic and quantity limits", () => {
    expect(() => paidCapacityEntitlementSchema.parse({ ...extra, paidExtraSlots: extraCompetitionSlotLimit + 1, resultingMaxExecutors: 32 })).toThrow();
    expect(() => paidCapacityEntitlementSchema.parse({ ...extra, resultingMaxExecutors: 6 })).toThrow("PAID_CAPACITY_RESULTING_SLOTS_MISMATCH");
    expect(() => paidCapacityEntitlementSchema.parse({ ...priority, prioritySlots: prioritySchedulingSlotLimit + 1 })).toThrow();
    expect(() => paidCapacityEntitlementSchema.parse({ ...extra, taskId: "42" })).toThrow();
    expect(() => paidCapacityEntitlementSchema.parse({ ...priority, priorityUnits: 4 })).toThrow();
    expect(assertPrioritySlotsFitTask(2, 2)).toBe(2);
    expect(() => assertPrioritySlotsFitTask(3, 2)).toThrow("PAID_CAPACITY_PRIORITY_SLOTS_EXCEED_TASK");
  });

  it("makes all quality, selection, challenge and protocol-result exclusions immutable", () => {
    for (const field of Object.keys(paidCapacityIsolationPolicy) as Array<keyof typeof paidCapacityIsolationPolicy>) {
      expect(() => paidCapacityEntitlementSchema.parse({ ...priority, isolation: { ...paidCapacityIsolationPolicy, [field]: true } })).toThrow();
    }
  });

  it("rejects reused receipts, wrong commercial bindings and inactive windows", () => {
    const review = { id: priority.definitionReviewId, publisher, chainId: 97 as const, taskRegistry, specHash, publishedTaskId: null };
    const existing = [{ entitlementId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", receiptId: priority.receipt.receiptId, receiptHash: `sha256:${"66".repeat(32)}` }];
    expect(() => authorizePriorityScheduling({ entitlement: priority, review, existingReceipts: existing, now: new Date("2026-09-03T00:00:00.000Z") }))
      .toThrow("PAID_CAPACITY_RECEIPT_ALREADY_USED");
    expect(() => authorizePriorityScheduling({ entitlement: priority, review: { ...review, publisher: "0x4444444444444444444444444444444444444444" }, now: new Date("2026-09-03T00:00:00.000Z") }))
      .toThrow("PAID_CAPACITY_PUBLISHER_MISMATCH");
    expect(() => authorizePriorityScheduling({ entitlement: priority, review: { ...review, taskRegistry: "0x4444444444444444444444444444444444444444" }, now: new Date("2026-09-03T00:00:00.000Z") }))
      .toThrow("PAID_CAPACITY_REGISTRY_MISMATCH");
    expect(() => authorizePriorityScheduling({ entitlement: priority, review, now: new Date("2026-09-02T01:01:30.000Z") }))
      .toThrow("PAID_CAPACITY_NOT_ACTIVE");
    expect(() => authorizePriorityScheduling({ entitlement: priority, review, now: new Date(priority.expiresAt) }))
      .toThrow("PAID_CAPACITY_EXPIRED");
  });

  it("rejects invalid payment and entitlement chronology", () => {
    expect(() => paidCapacityEntitlementSchema.parse({ ...priority, receipt: { ...priority.receipt, amountAtomic: "0" } })).toThrow();
    expect(() => paidCapacityEntitlementSchema.parse({ ...priority, receipt: { ...priority.receipt, settlementAsset: "AGT" } })).toThrow();
    expect(() => paidCapacityEntitlementSchema.parse({ ...priority, issuedAt: "2026-09-02T00:59:00.000Z" })).toThrow("PAID_CAPACITY_ISSUED_BEFORE_PAYMENT");
    expect(() => paidCapacityEntitlementSchema.parse({ ...priority, startsAt: "2026-09-02T01:00:30.000Z" })).toThrow("PAID_CAPACITY_STARTS_BEFORE_ISSUANCE");
    expect(() => paidCapacityEntitlementSchema.parse({ ...priority, expiresAt: priority.startsAt })).toThrow("PAID_CAPACITY_WINDOW_INVALID");
  });
});
