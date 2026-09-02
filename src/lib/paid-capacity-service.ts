import type { Hex } from "viem";
import { chainContractAddresses, isProductionMode, runtimeConfig } from "./env";
import { paidCapacityImportSchema } from "./paid-capacity-import";
import {
  verifyPaidCapacityEntitlementSignature,
  type PrioritySchedulingEntitlement,
} from "./paid-capacity-entitlement";
import { storeVerifiedPrioritySchedulingEntitlement } from "./store-postgres";

export async function importSignedPrioritySchedulingEntitlement(raw: unknown) {
  if (!isProductionMode()) throw new Error("PAID_CAPACITY_IMPORT_PRODUCTION_ONLY");
  const input = paidCapacityImportSchema.parse(raw);
  if (input.entitlement.kind !== "PRIORITY_SCHEDULING") throw new Error("PAID_CAPACITY_KIND_NOT_IMPORTABLE");
  const expectedIssuer = runtimeConfig().PAID_CAPACITY_ATTESTATION_SIGNER;
  if (!expectedIssuer) throw new Error("PAID_CAPACITY_ATTESTATION_SIGNER_REQUIRED");
  const verified = await verifyPaidCapacityEntitlementSignature({
    entitlement: input.entitlement,
    signature: input.signature as Hex,
    expectedIssuer,
  });
  const taskRegistry = chainContractAddresses().taskRegistry;
  if (verified.entitlement.chainId !== 97) throw new Error("PAID_CAPACITY_CHAIN_MISMATCH");
  if (verified.entitlement.taskRegistry.toLowerCase() !== taskRegistry.toLowerCase()) throw new Error("PAID_CAPACITY_REGISTRY_MISMATCH");
  return storeVerifiedPrioritySchedulingEntitlement({
    entitlement: verified.entitlement as PrioritySchedulingEntitlement,
    signature: input.signature as `0x${string}`,
    attestationHash: verified.entitlementHash,
    signingMessage: verified.message,
    taskRegistry,
  });
}
