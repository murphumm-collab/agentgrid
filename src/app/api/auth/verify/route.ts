import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, SESSION_COOKIE, verifyWalletChallenge } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { runtimeConfig } from "@/lib/env";
import { audit, requestId } from "@/lib/security";
import { readJsonBody } from "@/lib/request-body";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = await readJsonBody<{ address: string; nonce: string; message: string; signature: `0x${string}` }>(request);
    const result = await verifyWalletChallenge(input);
    await audit({ actor: result.address, action: "wallet.login", requestId: requestId(request), payload: { chainId: result.chainId } });
    const response = NextResponse.json({ address: result.address, chainId: result.chainId });
    response.cookies.set(SESSION_COOKIE, result.token, { httpOnly: true, secure: runtimeConfig().PROTOCOL_MODE === "production", sameSite: "lax", path: "/", maxAge: runtimeConfig().SESSION_TTL_SECONDS });
    return response;
  } catch (error) { return apiError(error); }
}
