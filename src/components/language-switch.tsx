"use client";

import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const router = useRouter();
  async function select(next: Locale) {
    if (next === locale) return;
    await fetch("/api/locale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: next }) });
    router.refresh();
  }
  return <div className="language-switch" aria-label="Language"><button className={locale === "zh" ? "active" : ""} onClick={() => void select("zh")}>中文</button><button className={locale === "en" ? "active" : ""} onClick={() => void select("en")}>EN</button></div>;
}
