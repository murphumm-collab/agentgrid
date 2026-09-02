import { getAddress, type Address } from "viem";
import { z } from "zod";

const address = z.string().transform((value, context) => {
  try { return getAddress(value); }
  catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid contract address" });
    return z.NEVER;
  }
});

export const browserChainConfigSchema = z.object({
  chainId: z.literal(97),
  confirmations: z.number().int().min(1).max(100),
  walletConnectProjectId: z.string().min(16).max(128).optional(),
  contracts: z.object({
    token: address,
    stakeManager: address,
    agentRegistry: address,
    taskRegistry: address,
    rewardVault: address,
    verificationPanel: address,
    verificationArbitrationCourt: address,
    disputeResolver: address,
    protocolEconomics: address,
    competitionSlotPassRegistry: address,
  }).strict(),
}).strict();

export interface BrowserChainConfig {
  chainId: 97;
  confirmations: number;
  walletConnectProjectId?: string;
  contracts: {
    token: Address;
    stakeManager: Address;
    agentRegistry: Address;
    taskRegistry: Address;
    rewardVault: Address;
    verificationPanel: Address;
    verificationArbitrationCourt: Address;
    disputeResolver: Address;
    protocolEconomics: Address;
    competitionSlotPassRegistry: Address;
  };
}

export function parseBrowserChainConfig(input: unknown): BrowserChainConfig {
  return browserChainConfigSchema.parse(input) as BrowserChainConfig;
}

let resolvedBrowserChainConfig: BrowserChainConfig | undefined;

export async function loadBrowserChainConfig() {
  if (resolvedBrowserChainConfig) return resolvedBrowserChainConfig;
  const response = await fetch("/api/chain/config", { cache: "no-store", headers: { accept: "application/json" } });
  const body = await response.json() as unknown;
  if (!response.ok) throw new Error((body as { error?: string })?.error ?? "CHAIN_CONFIG_UNAVAILABLE");
  resolvedBrowserChainConfig = parseBrowserChainConfig(body);
  return resolvedBrowserChainConfig;
}
