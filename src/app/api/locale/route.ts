import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { readJsonBody } from "@/lib/request-body";
import { z } from "zod";

const schema = z.object({ locale: z.enum(["en", "zh"]) }).strict();

export async function POST(request: NextRequest) {
  try {
    const { locale } = schema.parse(await readJsonBody(request));
    const response = NextResponse.json({ locale });
    response.cookies.set("agentgrid-locale", locale, { sameSite: "lax", maxAge: 60 * 60 * 24 * 365, path: "/" });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
