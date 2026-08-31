import { NextResponse } from "next/server";
import { artifactStorageReady } from "@/lib/artifacts";
import { chainDeploymentAddresses, isProductionMode, runtimeConfig } from "@/lib/env";
import { postgresReady } from "@/lib/store-postgres";
import { redisReady } from "@/lib/agent-queue";
import { enforceProductionFileSecrets, productionReadyFileSecrets } from "@/lib/secrets";
import { taskSpecAiConfigurationReady } from "@/lib/task-spec-assistant";
import { runtimeContractKeys, verifyRuntimeContractSet } from "@/lib/runtime-contract-verification";

async function rpc(method: string, params: unknown[] = []) {
  const response = await fetch(runtimeConfig().BSC_TESTNET_RPC_URL, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }), signal: AbortSignal.timeout(3_000),
  });
  const body = await response.json() as { result?: string; error?: unknown };
  if (!response.ok || body.error || typeof body.result !== "string") throw new Error("BSC_RPC_FAILED");
  return body.result;
}

export async function GET() {
  const checks: Record<string, boolean> = {
    configuration: true, artifactEncryption: true, database: true, redis: true,
    artifactStorage: true, alerting: !isProductionMode(), fileBackedSecrets: !isProductionMode(), taskDefinitionAi: !isProductionMode(), bscRpc: false, contractsDeployed: !isProductionMode(),
  };
  if (isProductionMode()) {
    try {
      checks.artifactEncryption = Boolean(runtimeConfig().ARTIFACT_MASTER_KEY);
      checks.alerting = Boolean(runtimeConfig().ALERT_WEBHOOK_URL && runtimeConfig().ALERT_WEBHOOK_SECRET);
      checks.fileBackedSecrets = runtimeConfig().REQUIRE_FILE_SECRETS && enforceProductionFileSecrets(process.env, productionReadyFileSecrets);
      checks.taskDefinitionAi = taskSpecAiConfigurationReady();
      checks.database = await postgresReady();
      checks.redis = await redisReady();
      checks.artifactStorage = await artifactStorageReady();
    } catch { checks.configuration = false; }
  }
  try {
    checks.bscRpc = Number.parseInt(await rpc("eth_chainId"), 16) === runtimeConfig().BSC_CHAIN_ID;
    if (isProductionMode() && checks.bscRpc) {
      try {
        const addresses = chainDeploymentAddresses();
        const code = await Promise.all(runtimeContractKeys.map((key) => rpc("eth_getCode", [addresses[key], "latest"])));
        verifyRuntimeContractSet(Object.fromEntries(runtimeContractKeys.map((key, index) => [key, code[index]])) as Record<(typeof runtimeContractKeys)[number], string>);
        checks.contractsDeployed = true;
      } catch { checks.contractsDeployed = false; }
    }
  } catch { checks.bscRpc = false; }
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json({ status: ready ? "ready" : "not-ready", mode: runtimeConfig().PROTOCOL_MODE, checks }, { status: ready ? 200 : 503 });
}
