import { NextResponse } from "next/server";
import { artifactStorageReady } from "@/lib/artifacts";
import { chainContractAddresses, isProductionMode, runtimeConfig } from "@/lib/env";
import { postgresReady } from "@/lib/store-postgres";
import { redisReady } from "@/lib/agent-queue";
import { enforceProductionFileSecrets, productionReadyFileSecrets } from "@/lib/secrets";

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
    artifactStorage: true, alerting: !isProductionMode(), fileBackedSecrets: !isProductionMode(), bscRpc: false, contractsDeployed: !isProductionMode(),
  };
  if (isProductionMode()) {
    try {
      checks.artifactEncryption = Boolean(runtimeConfig().ARTIFACT_MASTER_KEY);
      checks.alerting = Boolean(runtimeConfig().ALERT_WEBHOOK_URL && runtimeConfig().ALERT_WEBHOOK_SECRET);
      checks.fileBackedSecrets = runtimeConfig().REQUIRE_FILE_SECRETS && enforceProductionFileSecrets(process.env, productionReadyFileSecrets);
      checks.database = await postgresReady();
      checks.redis = await redisReady();
      checks.artifactStorage = await artifactStorageReady();
    } catch { checks.configuration = false; }
  }
  try {
    checks.bscRpc = Number.parseInt(await rpc("eth_chainId"), 16) === runtimeConfig().BSC_CHAIN_ID;
    if (isProductionMode() && checks.bscRpc) {
      try {
        const addresses = chainContractAddresses();
        const code = await Promise.all(Object.values(addresses).map((address) => rpc("eth_getCode", [address, "latest"])));
        checks.contractsDeployed = code.every((item) => Boolean(item && item !== "0x"));
      } catch { checks.contractsDeployed = false; }
    }
  } catch { checks.bscRpc = false; }
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json({ status: ready ? "ready" : "not-ready", mode: runtimeConfig().PROTOCOL_MODE, checks }, { status: ready ? 200 : 503 });
}
