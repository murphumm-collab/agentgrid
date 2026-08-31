import { NextResponse } from "next/server";
import { assertSameOrigin, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
