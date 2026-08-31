import "server-only";
import { cookies, headers } from "next/headers";
import type { Locale } from "./i18n";

export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get("agentgrid-locale")?.value;
  if (saved === "zh" || saved === "en") return saved;
  return (await headers()).get("accept-language")?.toLowerCase().includes("zh") ? "zh" : "en";
}
