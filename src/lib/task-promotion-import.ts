import { z } from "zod";
import { taskPromotionAttestationSchema } from "./task-promotion";

export const signedTaskPromotionImportSchema = z.object({
  attestation: taskPromotionAttestationSchema,
  signature: z.custom<`0x${string}`>((value) => typeof value === "string" && /^0x[0-9a-fA-F]{130}$/.test(value)),
}).strict();
