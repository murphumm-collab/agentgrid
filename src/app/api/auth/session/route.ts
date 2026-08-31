import { NextResponse } from "next/server";
import { readWalletSession } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({ session: await readWalletSession() }, { headers: { "cache-control": "private, no-store", vary: "Cookie" } });
}
