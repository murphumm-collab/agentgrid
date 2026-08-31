import { NextRequest, NextResponse } from "next/server";
import { createWalletChallenge } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { enforceRateLimit, requestClientKey } from "@/lib/security";
import { readJsonBody } from "@/lib/request-body";

export async function POST(request: NextRequest) {
  try {
    await enforceRateLimit(`auth-nonce:${requestClientKey(request)}`, 10, 60);
    const { address } = await readJsonBody<{ address: string }>(request);
    return NextResponse.json(await createWalletChallenge(address));
  } catch (error) { return apiError(error); }
}
