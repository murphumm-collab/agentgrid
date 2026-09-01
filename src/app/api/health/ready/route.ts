import { NextResponse } from "next/server";
import { artifactStorageReady } from "@/lib/artifacts";
import { chainDeploymentAddresses, runtimeConfig, type RuntimeConfig } from "@/lib/env";
import { postgresReady } from "@/lib/store-postgres";
import { redisReady } from "@/lib/agent-queue";
import { enforceProductionFileSecrets, productionReadyFileSecrets } from "@/lib/secrets";
import { taskSpecAiConfigurationReady } from "@/lib/task-spec-assistant";
import { runtimeContractKeys, verifyRuntimeContractSet } from "@/lib/runtime-contract-verification";
import { bscRpcResult } from "@/lib/bsc-rpc";

export async function GET() {
  let config: RuntimeConfig | undefined;
  try { config = runtimeConfig(); } catch { /* configuration check remains false */ }
  const production = (config?.PROTOCOL_MODE ?? process.env.PROTOCOL_MODE) === "production";
  const checks: Record<string, boolean> = {
    configuration: Boolean(config), artifactEncryption: !production, database: !production, redis: !production,
    artifactStorage: !production, alerting: !production, fileBackedSecrets: !production, taskDefinitionAi: !production, bscRpc: false, contractsDeployed: !production,
  };
  if (production && config) {
    try {
      checks.artifactEncryption = Boolean(config.ARTIFACT_MASTER_KEY);
      checks.alerting = Boolean(config.ALERT_WEBHOOK_URL && config.ALERT_WEBHOOK_SECRET);
      checks.fileBackedSecrets = config.REQUIRE_FILE_SECRETS && enforceProductionFileSecrets(process.env, productionReadyFileSecrets);
      checks.taskDefinitionAi = taskSpecAiConfigurationReady();
      checks.database = await postgresReady();
      checks.redis = await redisReady();
      checks.artifactStorage = await artifactStorageReady();
    } catch { checks.configuration = false; }
  }
  if (config) try {
    const rpc = (method: string, params: unknown[] = []) => bscRpcResult(config.BSC_TESTNET_RPC_URL, method, params);
    checks.bscRpc = Number.parseInt(await rpc("eth_chainId"), 16) === config.BSC_CHAIN_ID;
    if (production && checks.bscRpc) {
      try {
        const addresses = chainDeploymentAddresses();
        const code = await Promise.all(runtimeContractKeys.map((key) => rpc("eth_getCode", [addresses[key], "latest"])));
        verifyRuntimeContractSet(Object.fromEntries(runtimeContractKeys.map((key, index) => [key, code[index]])) as Record<(typeof runtimeContractKeys)[number], string>);
        checks.contractsDeployed = true;
      } catch { checks.contractsDeployed = false; }
    }
  } catch { checks.bscRpc = false; }
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json({ status: ready ? "ready" : "not-ready", mode: config?.PROTOCOL_MODE ?? "invalid", checks }, { status: ready ? 200 : 503 });
}
