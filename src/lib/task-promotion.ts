import { getAddress, keccak256, recoverMessageAddress, stringToHex, type Hex } from "viem";
import { z } from "zod";

export const taskPromotionSigningVersion = "AgentGrid Task Promotion V1" as const;
const maximumPromotionDurationMs = 31 * 86_400_000;

export const taskPromotionAttestationSchema = z.object({
  version: z.literal(taskPromotionSigningVersion),
  chainId: z.literal(97),
  taskRegistry: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  taskId: z.string().regex(/^[1-9][0-9]*$/).max(78),
  placement: z.enum(["HOMEPAGE", "CATEGORY"]),
  category: z.string().min(1).max(64).nullable(),
  sponsor: z.string().min(1).max(80),
  settlementAsset: z.enum(["USDT", "USDC", "BNB"]),
  paymentReceiptHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  issuedAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.placement === "CATEGORY" && !value.category) context.addIssue({ code: "custom", path: ["category"], message: "PROMOTION_CATEGORY_REQUIRED" });
  if (value.placement === "HOMEPAGE" && value.category !== null) context.addIssue({ code: "custom", path: ["category"], message: "HOMEPAGE_CATEGORY_MUST_BE_NULL" });
  const startsAt = Date.parse(value.startsAt);
  const endsAt = Date.parse(value.endsAt);
  const issuedAt = Date.parse(value.issuedAt);
  if (endsAt <= startsAt) context.addIssue({ code: "custom", path: ["endsAt"], message: "PROMOTION_WINDOW_INVALID" });
  if (endsAt - startsAt > maximumPromotionDurationMs) context.addIssue({ code: "custom", path: ["endsAt"], message: "PROMOTION_WINDOW_TOO_LONG" });
  if (issuedAt > startsAt) context.addIssue({ code: "custom", path: ["issuedAt"], message: "PROMOTION_ISSUED_AFTER_START" });
});

export type TaskPromotionAttestation = z.infer<typeof taskPromotionAttestationSchema>;

export interface SignedTaskPromotion {
  attestation: TaskPromotionAttestation;
  signature: Hex;
}

export interface PublicTaskPromotion {
  label: "SPONSORED";
  placement: TaskPromotionAttestation["placement"];
  category: string | null;
  sponsor: string;
  startsAt: string;
  endsAt: string;
  settlementAsset: TaskPromotionAttestation["settlementAsset"];
  paymentReceiptHash: string;
  attestationHash: Hex;
  attester: `0x${string}`;
  protocolInfluence: "NONE";
}

export function taskPromotionSigningMessage(input: TaskPromotionAttestation) {
  const value = taskPromotionAttestationSchema.parse(input);
  return [
    taskPromotionSigningVersion,
    `Chain ID: ${value.chainId}`,
    `TaskRegistry: ${value.taskRegistry.toLowerCase()}`,
    `Task ID: ${value.taskId}`,
    `Placement: ${value.placement}`,
    `Category: ${value.category ?? "NONE"}`,
    `Sponsor: ${value.sponsor}`,
    `Settlement Asset: ${value.settlementAsset}`,
    `Payment Receipt: ${value.paymentReceiptHash}`,
    `Starts At: ${value.startsAt}`,
    `Ends At: ${value.endsAt}`,
    `Issued At: ${value.issuedAt}`,
    "Protocol Influence: NONE",
  ].join("\n");
}

export async function verifyTaskPromotion(input: SignedTaskPromotion, expected: {
  signer: `0x${string}`;
  chainId: 97;
  taskRegistry: `0x${string}`;
  taskId?: string;
  now?: Date;
  allowNotStarted?: boolean;
}) {
  const attestation = taskPromotionAttestationSchema.parse(input.attestation);
  if (attestation.chainId !== expected.chainId) throw new Error("PROMOTION_CHAIN_MISMATCH");
  if (attestation.taskRegistry.toLowerCase() !== expected.taskRegistry.toLowerCase()) throw new Error("PROMOTION_REGISTRY_MISMATCH");
  if (expected.taskId && attestation.taskId !== expected.taskId) throw new Error("PROMOTION_TASK_MISMATCH");
  const message = taskPromotionSigningMessage(attestation);
  const recovered = await recoverMessageAddress({ message, signature: input.signature });
  if (recovered.toLowerCase() !== expected.signer.toLowerCase()) throw new Error("PROMOTION_SIGNATURE_INVALID");
  const now = (expected.now ?? new Date()).getTime();
  if (Date.parse(attestation.issuedAt) > now) throw new Error("PROMOTION_ISSUED_IN_FUTURE");
  if (!expected.allowNotStarted && now < Date.parse(attestation.startsAt)) throw new Error("PROMOTION_NOT_STARTED");
  if (now >= Date.parse(attestation.endsAt)) throw new Error("PROMOTION_EXPIRED");
  const attestationHash = keccak256(stringToHex(`${message}\nSignature: ${input.signature.toLowerCase()}`));
  return {
    label: "SPONSORED",
    placement: attestation.placement,
    category: attestation.category,
    sponsor: attestation.sponsor,
    startsAt: attestation.startsAt,
    endsAt: attestation.endsAt,
    settlementAsset: attestation.settlementAsset,
    paymentReceiptHash: attestation.paymentReceiptHash,
    attestationHash,
    attester: getAddress(recovered),
    protocolInfluence: "NONE",
  } satisfies PublicTaskPromotion;
}
