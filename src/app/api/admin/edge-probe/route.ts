import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { runtimeConfig } from "@/lib/env";
import { apiError } from "@/lib/http";
import { requestClientKey } from "@/lib/security";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json({
      observedAt: new Date().toISOString(),
      trustedProxy: runtimeConfig().TRUST_PROXY,
      clientKey: requestClientKey(request),
    });
  } catch (error) { return apiError(error); }
}
