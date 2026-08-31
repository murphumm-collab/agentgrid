import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { readJsonBody } from "@/lib/request-body";

export async function POST(request: NextRequest) {
  try {
    const { locale } = await readJsonBody<{ locale: string }>(request);
    if (locale !== "en" && locale !== "zh") return NextResponse.json({ error: "INVALID_LOCALE" }, { status: 400 });
    const response = NextResponse.json({ locale });
    response.cookies.set("agentgrid-locale", locale, { sameSite: "lax", maxAge: 60 * 60 * 24 * 365, path: "/" });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
