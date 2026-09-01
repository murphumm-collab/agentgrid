import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { taskPromotionSigningMessage, verifyTaskPromotion, type SignedTaskPromotion, type TaskPromotionAttestation } from "./task-promotion";
import { signedTaskPromotionImportSchema } from "./task-promotion-import";
import { rankMarketplaceTasks } from "./marketplace-ranking";

const signer = privateKeyToAccount(`0x${"1".repeat(64)}`);
const registry = `0x${"a".repeat(40)}` as const;
const base = {
  version: "AgentGrid Task Promotion V1",
  chainId: 97,
  taskRegistry: registry,
  taskId: "42",
  placement: "HOMEPAGE",
  category: null,
  sponsor: "Open tools sponsor",
  settlementAsset: "USDT",
  paymentReceiptHash: `sha256:${"b".repeat(64)}`,
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-09-08T00:00:00.000Z",
  issuedAt: "2026-08-31T23:00:00.000Z",
} satisfies TaskPromotionAttestation;

async function signed(attestation = base): Promise<SignedTaskPromotion> {
  return { attestation, signature: await signer.signMessage({ message: taskPromotionSigningMessage(attestation) }) };
}

describe("task promotion attestations", () => {
  it("verifies a receipt-bound placement and exposes no protocol influence", async () => {
    const promotion = await verifyTaskPromotion(await signed(), { signer: signer.address, chainId: 97, taskRegistry: registry, taskId: "42", now: new Date("2026-09-02T00:00:00.000Z") });
    expect(promotion).toMatchObject({ label: "SPONSORED", placement: "HOMEPAGE", settlementAsset: "USDT", protocolInfluence: "NONE", attester: signer.address });
    expect(promotion.attestationHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("fails closed for tampering, the wrong signer, task replay and expired placements", async () => {
    const original = await signed();
    await expect(verifyTaskPromotion({ ...original, attestation: { ...base, sponsor: "tampered" } }, { signer: signer.address, chainId: 97, taskRegistry: registry, taskId: "42", now: new Date("2026-09-02") })).rejects.toThrow("PROMOTION_SIGNATURE_INVALID");
    await expect(verifyTaskPromotion(original, { signer: `0x${"2".repeat(40)}`, chainId: 97, taskRegistry: registry, taskId: "42", now: new Date("2026-09-02") })).rejects.toThrow("PROMOTION_SIGNATURE_INVALID");
    await expect(verifyTaskPromotion(original, { signer: signer.address, chainId: 97, taskRegistry: registry, taskId: "43", now: new Date("2026-09-02") })).rejects.toThrow("PROMOTION_TASK_MISMATCH");
    await expect(verifyTaskPromotion(original, { signer: signer.address, chainId: 97, taskRegistry: registry, taskId: "42", now: new Date("2026-09-08") })).rejects.toThrow("PROMOTION_EXPIRED");
  });

  it("allows a verified future window only for controlled import while still rejecting expired imports", async () => {
    const original = await signed();
    const expected = { signer: signer.address, chainId: 97 as const, taskRegistry: registry, taskId: "42", now: new Date("2026-08-31T23:30:00.000Z") };
    await expect(verifyTaskPromotion(original, expected)).rejects.toThrow("PROMOTION_NOT_STARTED");
    await expect(verifyTaskPromotion(original, { ...expected, allowNotStarted: true })).resolves.toMatchObject({ label: "SPONSORED" });
    await expect(verifyTaskPromotion(original, { ...expected, allowNotStarted: true, now: new Date("2026-09-08T00:00:00.000Z") })).rejects.toThrow("PROMOTION_EXPIRED");
  });

  it("changes display order only and preserves canonical task objects and protocol fields", async () => {
    const promotion = await verifyTaskPromotion(await signed(), { signer: signer.address, chainId: 97, taskRegistry: registry, now: new Date("2026-09-02") });
    const canonical = [
      { id: "1", testerIds: ["validator-a"], quality: 9000 },
      { id: "42", testerIds: ["validator-b"], quality: 1000, promotion },
    ];
    const ranked = rankMarketplaceTasks(canonical, "HOMEPAGE", new Date("2026-09-02"));
    expect(ranked.map((task) => task.id)).toEqual(["42", "1"]);
    expect(ranked[0]).toBe(canonical[1]);
    expect(canonical.map(({ id, testerIds, quality }) => ({ id, testerIds, quality }))).toEqual([
      { id: "1", testerIds: ["validator-a"], quality: 9000 },
      { id: "42", testerIds: ["validator-b"], quality: 1000 },
    ]);
    expect(rankMarketplaceTasks(canonical, { category: "Development" }, new Date("2026-09-02"))).toEqual(canonical);
  });

  it("rejects ambiguous placement scope and windows longer than 31 days", () => {
    expect(() => taskPromotionSigningMessage({ ...base, category: "Development" })).toThrow("HOMEPAGE_CATEGORY_MUST_BE_NULL");
    expect(() => taskPromotionSigningMessage({ ...base, endsAt: "2026-11-08T00:00:00.000Z" })).toThrow("PROMOTION_WINDOW_TOO_LONG");
  });

  it("closes the production import envelope and persists receipt/window replay guards", async () => {
    const envelope = await signed();
    expect(signedTaskPromotionImportSchema.safeParse(envelope).success).toBe(true);
    expect(signedTaskPromotionImportSchema.safeParse({ ...envelope, ignored: true }).success).toBe(false);
    const storeSource = readFileSync(new URL("./store-postgres.ts", import.meta.url), "utf8");
    expect(storeSource).toContain("payment_receipt_hash TEXT NOT NULL UNIQUE");
    expect(storeSource).toContain("pg_advisory_xact_lock");
    expect(storeSource).toContain("PROMOTION_WINDOW_OVERLAP");
  });
});
