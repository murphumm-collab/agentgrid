import { getAddress, keccak256, recoverMessageAddress, stringToHex, type Hex } from "viem";
import { z } from "zod";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

export const includedCompetitionSlots = 2 as const;
export const extraCompetitionSlotLimit = 30 as const;
export const prioritySchedulingSlotLimit = 32 as const;
export const paidCapacityEntitlementSigningVersion = "AgentGrid Paid Capacity Entitlement V1" as const;

export const paidCapacityIsolationPolicySchema = z.object({
  acceptanceCriteriaAffected: z.literal(false),
  taskDeadlineAffected: z.literal(false),
  evaluatorSelectionAffected: z.literal(false),
  validatorSelectionAffected: z.literal(false),
  arbitratorSelectionAffected: z.literal(false),
  qualityGatesAffected: z.literal(false),
  challengeRightsAffected: z.literal(false),
  challengeWindowAffected: z.literal(false),
  rewardPoolAffected: z.literal(false),
}).strict();

export const paidCapacityIsolationPolicy = Object.freeze({
  acceptanceCriteriaAffected: false,
  taskDeadlineAffected: false,
  evaluatorSelectionAffected: false,
  validatorSelectionAffected: false,
  arbitratorSelectionAffected: false,
  qualityGatesAffected: false,
  challengeRightsAffected: false,
  challengeWindowAffected: false,
  rewardPoolAffected: false,
} as const);

export const paidCapacityReceiptSchema = z.object({
  processor: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  receiptId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  receiptHash: sha256Schema,
  amountAtomic: z.string().min(1).max(78).regex(/^[1-9][0-9]*$/),
  settlementAsset: z.enum(["USDT", "USDC", "BNB"]),
  paidAt: timestampSchema,
}).strict();

const commonEntitlementShape = {
  version: z.literal(1),
  entitlementId: z.string().uuid(),
  chainId: z.literal(97),
  taskRegistry: addressSchema,
  publisher: addressSchema,
  issuer: addressSchema,
  receipt: paidCapacityReceiptSchema,
  issuedAt: timestampSchema,
  startsAt: timestampSchema,
  expiresAt: timestampSchema,
  isolation: paidCapacityIsolationPolicySchema,
  definitionReviewId: z.string().uuid(),
  specHash: bytes32Schema,
};

const extraCompetitionSlotsSchema = z.object({
  ...commonEntitlementShape,
  kind: z.literal("EXTRA_COMPETITION_SLOTS"),
  effect: z.literal("EXECUTOR_CAPACITY_ONLY"),
  executorRecipientWeightsMayChange: z.literal(true),
  includedCompetitionSlots: z.literal(includedCompetitionSlots),
  paidExtraSlots: z.number().int().min(1).max(extraCompetitionSlotLimit),
  resultingMaxExecutors: z.number().int().min(3).max(32),
}).strict();

const prioritySchedulingSchema = z.object({
  ...commonEntitlementShape,
  kind: z.literal("PRIORITY_SCHEDULING"),
  effect: z.literal("EXECUTOR_GENERAL_QUEUE_ORDER_ONLY"),
  executorRecipientWeightsMayChange: z.literal(false),
  prioritySlots: z.number().int().min(1).max(prioritySchedulingSlotLimit),
}).strict();

export const paidCapacityEntitlementSchema = z.discriminatedUnion("kind", [
  extraCompetitionSlotsSchema,
  prioritySchedulingSchema,
]).superRefine((value, context) => {
  if (value.kind === "EXTRA_COMPETITION_SLOTS"
    && includedCompetitionSlots + value.paidExtraSlots !== value.resultingMaxExecutors) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultingMaxExecutors"], message: "PAID_CAPACITY_RESULTING_SLOTS_MISMATCH" });
  }
  const paidAt = Date.parse(value.receipt.paidAt);
  const issuedAt = Date.parse(value.issuedAt);
  const startsAt = Date.parse(value.startsAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (issuedAt < paidAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ["issuedAt"], message: "PAID_CAPACITY_ISSUED_BEFORE_PAYMENT" });
  if (startsAt < issuedAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ["startsAt"], message: "PAID_CAPACITY_STARTS_BEFORE_ISSUANCE" });
  if (expiresAt <= startsAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "PAID_CAPACITY_WINDOW_INVALID" });
});

export type PaidCapacityEntitlement = z.infer<typeof paidCapacityEntitlementSchema>;
export type ExtraCompetitionSlotsEntitlement = Extract<PaidCapacityEntitlement, { kind: "EXTRA_COMPETITION_SLOTS" }>;
export type PrioritySchedulingEntitlement = Extract<PaidCapacityEntitlement, { kind: "PRIORITY_SCHEDULING" }>;

export const signedPaidCapacityEntitlementSchema = z.object({
  entitlement: paidCapacityEntitlementSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function scopeLabel(entitlement: PaidCapacityEntitlement) {
  return entitlement.kind === "EXTRA_COMPETITION_SLOTS"
    ? `Definition review: ${entitlement.definitionReviewId}\nSpec: ${entitlement.specHash}\nIncluded competition slots: ${entitlement.includedCompetitionSlots}\nPaid extra slots: ${entitlement.paidExtraSlots}\nResulting executors: ${entitlement.resultingMaxExecutors}`
    : `Definition review: ${entitlement.definitionReviewId}\nSpec: ${entitlement.specHash}\nPriority slots: ${entitlement.prioritySlots}`;
}

export function paidCapacityEntitlementMessage(raw: PaidCapacityEntitlement) {
  const entitlement = paidCapacityEntitlementSchema.parse(raw);
  const entitlementHash = keccak256(stringToHex(JSON.stringify(canonical(entitlement))));
  return {
    entitlement,
    entitlementHash,
    message: [
      paidCapacityEntitlementSigningVersion,
      `Chain ID: ${entitlement.chainId}`,
      `TaskRegistry: ${entitlement.taskRegistry.toLowerCase()}`,
      `Publisher: ${entitlement.publisher.toLowerCase()}`,
      `Issuer: ${entitlement.issuer.toLowerCase()}`,
      `Entitlement: ${entitlement.entitlementId}`,
      `Kind: ${entitlement.kind}`,
      scopeLabel(entitlement),
      `Receipt ID: ${entitlement.receipt.receiptId}`,
      `Receipt: ${entitlement.receipt.receiptHash}`,
      `Settlement asset: ${entitlement.receipt.settlementAsset}`,
      `Amount atomic: ${entitlement.receipt.amountAtomic}`,
      `Starts: ${entitlement.startsAt}`,
      `Expires: ${entitlement.expiresAt}`,
      `Hash: ${entitlementHash}`,
    ].join("\n"),
  };
}

export async function verifyPaidCapacityEntitlementSignature(input: {
  entitlement: PaidCapacityEntitlement;
  signature: Hex;
  expectedIssuer: string;
}) {
  const commitment = paidCapacityEntitlementMessage(input.entitlement);
  const expectedIssuer = getAddress(input.expectedIssuer);
  if (getAddress(commitment.entitlement.issuer) !== expectedIssuer) throw new Error("PAID_CAPACITY_ISSUER_MISMATCH");
  const signer = await recoverMessageAddress({ message: commitment.message, signature: input.signature });
  if (signer.toLowerCase() !== expectedIssuer.toLowerCase()) throw new Error("PAID_CAPACITY_SIGNATURE_INVALID");
  return { ...commitment, signer };
}

export interface PaidCapacityReceiptReference {
  entitlementId: string;
  receiptId: string;
  receiptHash: string;
}

function assertCommonEligibility(input: {
  entitlement: PaidCapacityEntitlement;
  expectedChainId: 97;
  expectedTaskRegistry: string;
  expectedPublisher: string;
  existingReceipts?: PaidCapacityReceiptReference[];
  now?: Date;
}) {
  const { entitlement } = input;
  if (entitlement.chainId !== input.expectedChainId) throw new Error("PAID_CAPACITY_CHAIN_MISMATCH");
  if (getAddress(entitlement.taskRegistry) !== getAddress(input.expectedTaskRegistry)) throw new Error("PAID_CAPACITY_REGISTRY_MISMATCH");
  if (getAddress(entitlement.publisher) !== getAddress(input.expectedPublisher)) throw new Error("PAID_CAPACITY_PUBLISHER_MISMATCH");
  const duplicate = (input.existingReceipts ?? []).find((item) => item.entitlementId === entitlement.entitlementId
    || item.receiptId === entitlement.receipt.receiptId
    || item.receiptHash.toLowerCase() === entitlement.receipt.receiptHash.toLowerCase());
  if (duplicate) throw new Error("PAID_CAPACITY_RECEIPT_ALREADY_USED");
  const now = (input.now ?? new Date()).getTime();
  if (now < Date.parse(entitlement.startsAt)) throw new Error("PAID_CAPACITY_NOT_ACTIVE");
  if (now >= Date.parse(entitlement.expiresAt)) throw new Error("PAID_CAPACITY_EXPIRED");
}

export function authorizeExtraCompetitionSlots(input: {
  entitlement: ExtraCompetitionSlotsEntitlement;
  review: {
    id: string;
    publisher: string;
    chainId: 97;
    taskRegistry: string;
    executionMode: "COLLABORATION" | "COMPETITION";
    specHash: string;
    publishedTaskId: string | null;
  };
  existingReceipts?: PaidCapacityReceiptReference[];
  now?: Date;
}) {
  const entitlement = paidCapacityEntitlementSchema.parse(input.entitlement);
  if (entitlement.kind !== "EXTRA_COMPETITION_SLOTS") throw new Error("PAID_CAPACITY_KIND_MISMATCH");
  assertCommonEligibility({ entitlement, expectedChainId: input.review.chainId, expectedTaskRegistry: input.review.taskRegistry, expectedPublisher: input.review.publisher, existingReceipts: input.existingReceipts, now: input.now });
  if (input.review.publishedTaskId !== null) throw new Error("PAID_CAPACITY_REVIEW_ALREADY_PUBLISHED");
  if (input.review.executionMode !== "COMPETITION") throw new Error("PAID_CAPACITY_COMPETITION_ONLY");
  if (entitlement.definitionReviewId !== input.review.id) throw new Error("PAID_CAPACITY_REVIEW_MISMATCH");
  if (entitlement.specHash.toLowerCase() !== input.review.specHash.toLowerCase()) throw new Error("PAID_CAPACITY_SPEC_MISMATCH");
  return {
    kind: entitlement.kind,
    definitionReviewId: entitlement.definitionReviewId,
    additionalSlots: entitlement.paidExtraSlots,
    resultingMaxExecutors: entitlement.resultingMaxExecutors,
    effect: entitlement.effect,
    executorRecipientWeightsMayChange: entitlement.executorRecipientWeightsMayChange,
    rewardPoolAffected: entitlement.isolation.rewardPoolAffected,
    requiredEnforcement: "ONCHAIN_COMPETITION_SLOT_PASS_REGISTRY" as const,
    isolation: entitlement.isolation,
  };
}

export function authorizePriorityScheduling(input: {
  entitlement: PrioritySchedulingEntitlement;
  review: { id: string; publisher: string; chainId: 97; taskRegistry: string; specHash: string; publishedTaskId: string | null };
  existingReceipts?: PaidCapacityReceiptReference[];
  now?: Date;
}) {
  const entitlement = paidCapacityEntitlementSchema.parse(input.entitlement);
  if (entitlement.kind !== "PRIORITY_SCHEDULING") throw new Error("PAID_CAPACITY_KIND_MISMATCH");
  assertCommonEligibility({ entitlement, expectedChainId: input.review.chainId, expectedTaskRegistry: input.review.taskRegistry, expectedPublisher: input.review.publisher, existingReceipts: input.existingReceipts, now: input.now });
  if (input.review.publishedTaskId !== null) throw new Error("PAID_CAPACITY_REVIEW_ALREADY_PUBLISHED");
  if (entitlement.definitionReviewId !== input.review.id) throw new Error("PAID_CAPACITY_REVIEW_MISMATCH");
  if (entitlement.specHash.toLowerCase() !== input.review.specHash.toLowerCase()) throw new Error("PAID_CAPACITY_SPEC_MISMATCH");
  return {
    kind: entitlement.kind,
    definitionReviewId: entitlement.definitionReviewId,
    prioritySlots: entitlement.prioritySlots,
    effect: entitlement.effect,
    executorRecipientWeightsMayChange: entitlement.executorRecipientWeightsMayChange,
    rewardPoolAffected: entitlement.isolation.rewardPoolAffected,
    requiredEnforcement: "APPLICATION_FAIR_QUEUE_3_TO_1" as const,
    isolation: entitlement.isolation,
  };
}
