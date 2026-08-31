import { z } from "zod";
import { enforceProductionFileSecrets, resolvedRuntimeSecretEnvironment } from "./secrets";

const schema = z.object({
  PROTOCOL_MODE: z.enum(["demo", "production"]).default("demo"),
  PUBLIC_SHOWCASE_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  DEMO_DATA_DIRECTORY: z.string().min(1).optional(),
  REQUIRE_FILE_SECRETS: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  AGENT_LEASE_SECONDS: z.coerce.number().int().min(15).max(900).default(60),
  S3_ENDPOINT: z.string().url().default("http://127.0.0.1:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(3).default("agentgrid-artifacts"),
  S3_ACCESS_KEY: z.string().min(3).default("agentgrid"),
  S3_SECRET_KEY: z.string().min(8).default("local-agentgrid-storage-password"),
  ARTIFACT_MASTER_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  ARTIFACT_PREVIOUS_MASTER_KEYS: z.string().regex(/^[0-9a-fA-F]{64}(,[0-9a-fA-F]{64})*$/).optional(),
  ADMIN_API_KEY: z.string().min(32).optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ALERT_WEBHOOK_SECRET: z.string().min(32).optional(),
  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_ORIGIN: z.string().url().default("http://localhost:3000"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  TRUSTED_PROXY_SHARED_SECRET: z.string().min(32).optional(),
  BSC_CHAIN_ID: z.coerce.number().int().default(97),
  BSC_TESTNET_RPC_URL: z.string().url().default("https://bsc-testnet-dataseed.bnbchain.org"),
  CHAIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(5),
  CHAIN_START_BLOCK: z.coerce.number().int().min(0).default(0),
  WALLETCONNECT_PROJECT_ID: z.string().min(16).max(128).optional(),
  TOKEN_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  STAKE_MANAGER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  AGENT_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  TASK_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  REWARD_VAULT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  DISPUTE_RESOLVER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  NEXT_PUBLIC_TOKEN_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  NEXT_PUBLIC_STAKE_MANAGER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  NEXT_PUBLIC_TASK_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  NEXT_PUBLIC_REWARD_VAULT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(86_400),
});

export type RuntimeConfig = z.infer<typeof schema>;

let cached: RuntimeConfig | undefined;

export function runtimeConfig(): RuntimeConfig {
  cached ??= schema.parse({ ...process.env, ...resolvedRuntimeSecretEnvironment() });
  if (cached.PROTOCOL_MODE === "production") {
    if (!cached.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED_IN_PRODUCTION");
    if (!cached.AUTH_SECRET) throw new Error("AUTH_SECRET_REQUIRED_IN_PRODUCTION");
    if (cached.TRUST_PROXY && !cached.TRUSTED_PROXY_SHARED_SECRET) throw new Error("TRUSTED_PROXY_SHARED_SECRET_REQUIRED_IN_PRODUCTION");
    if (cached.REQUIRE_FILE_SECRETS) enforceProductionFileSecrets();
  }
  return cached;
}

export function chainContractAddresses() {
  const config = runtimeConfig();
  const addresses = {
    token: config.TOKEN_ADDRESS ?? config.NEXT_PUBLIC_TOKEN_ADDRESS,
    stakeManager: config.STAKE_MANAGER_ADDRESS ?? config.NEXT_PUBLIC_STAKE_MANAGER_ADDRESS,
    agentRegistry: config.AGENT_REGISTRY_ADDRESS ?? config.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS,
    taskRegistry: config.TASK_REGISTRY_ADDRESS ?? config.NEXT_PUBLIC_TASK_REGISTRY_ADDRESS,
    rewardVault: config.REWARD_VAULT_ADDRESS ?? config.NEXT_PUBLIC_REWARD_VAULT_ADDRESS,
  };
  if (Object.values(addresses).some((address) => !address)) throw new Error("CHAIN_CONTRACT_ADDRESSES_REQUIRED");
  return addresses as { token: `0x${string}`; stakeManager: `0x${string}`; agentRegistry: `0x${string}`; taskRegistry: `0x${string}`; rewardVault: `0x${string}` };
}

export function chainDeploymentAddresses() {
  const contracts = chainContractAddresses();
  const disputeResolver = runtimeConfig().DISPUTE_RESOLVER_ADDRESS;
  if (!disputeResolver) throw new Error("DISPUTE_RESOLVER_ADDRESS_REQUIRED");
  return { ...contracts, disputeResolver: disputeResolver as `0x${string}` };
}

export function isProductionMode() {
  return runtimeConfig().PROTOCOL_MODE === "production";
}

export function isShowcaseMode() {
  return runtimeConfig().PUBLIC_SHOWCASE_MODE;
}

export function resetRuntimeConfigForTests() {
  cached = undefined;
}
