import { NextResponse } from "next/server";
import { assertSameOrigin, SESSION_COOKIE } from "@/lib/auth";
import { runtimeConfig } from "@/lib/env";
import { apiError } from "@/lib/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true, secure: runtimeConfig().PROTOCOL_MODE === "production", sameSite: "lax", path: "/", maxAge: 0,
    });
    return response;
  } catch (error) { return apiError(error); }
}
