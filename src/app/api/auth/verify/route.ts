import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, SESSION_COOKIE, verifyWalletChallenge } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { runtimeConfig } from "@/lib/env";
import { audit, enforceRateLimit, requestClientKey, requestId } from "@/lib/security";
import { readJsonBody } from "@/lib/request-body";
import { walletChallengeResponseSchema } from "@/lib/auth-schema";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(`auth-verify:${requestClientKey(request)}`, 20, 60);
    const input = walletChallengeResponseSchema.parse(await readJsonBody(request));
    const result = await verifyWalletChallenge(input);
    await audit({ actor: result.address, action: "wallet.login", requestId: requestId(request), payload: { chainId: result.chainId } });
    const response = NextResponse.json({ address: result.address, chainId: result.chainId });
    response.cookies.set(SESSION_COOKIE, result.token, { httpOnly: true, secure: runtimeConfig().PROTOCOL_MODE === "production", sameSite: "lax", path: "/", maxAge: runtimeConfig().SESSION_TTL_SECONDS });
    return response;
  } catch (error) { return apiError(error); }
}
