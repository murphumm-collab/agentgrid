import { z } from "zod";

export const walletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const walletChallengeRequestSchema = z.object({
  address: walletAddressSchema,
}).strict();

export const walletChallengeResponseSchema = z.object({
  address: walletAddressSchema,
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  message: z.string().min(1).max(2_048),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform((value) => value as `0x${string}`),
}).strict();

export type WalletChallengeResponse = z.output<typeof walletChallengeResponseSchema>;
