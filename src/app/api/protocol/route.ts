import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { protocolSnapshot } from "@/lib/service";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return NextResponse.json(await protocolSnapshot());
  } catch (error) {
    return apiError(error);
  }
}
