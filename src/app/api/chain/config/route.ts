import { NextResponse } from "next/server";
import { chainDeploymentAddresses, runtimeConfig } from "@/lib/env";
import { apiError } from "@/lib/http";
import { parseBrowserChainConfig } from "@/lib/browser-chain-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runtime = runtimeConfig();
    const contracts = chainDeploymentAddresses();
    return NextResponse.json(parseBrowserChainConfig({
      chainId: runtime.BSC_CHAIN_ID,
      confirmations: runtime.CHAIN_CONFIRMATIONS,
      walletConnectProjectId: runtime.WALLETCONNECT_PROJECT_ID,
      contracts,
    }));
  } catch (error) {
    return apiError(error);
  }
}
