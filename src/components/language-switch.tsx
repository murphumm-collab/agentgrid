"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { ActionNotice, type ActionResult } from "./action-notice";

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const inFlight = useRef(false);

  async function select(next: Locale) {
    if (next === locale || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/locale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: next }) });
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : (locale === "zh" ? "语言切换失败，请重试。" : "Unable to change language. Try again."));
      setResult({ tone: "success", message: next === "zh" ? "已切换为中文。" : "Language changed to English." });
      router.refresh();
    } catch (error) {
      setResult({ tone: "error", message: error instanceof Error ? error.message : (locale === "zh" ? "语言切换失败，请重试。" : "Unable to change language. Try again.") });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return <div className="language-switch-control">
    <div className="language-switch" role="group" aria-label={locale === "zh" ? "语言" : "Language"}>
      <button type="button" className={locale === "zh" ? "active" : ""} aria-pressed={locale === "zh"} aria-busy={busy} disabled={busy} onClick={() => void select("zh")}>中文</button>
      <button type="button" className={locale === "en" ? "active" : ""} aria-pressed={locale === "en"} aria-busy={busy} disabled={busy} onClick={() => void select("en")}>EN</button>
    </div>
    {result && <div className="language-switch-result"><ActionNotice tone={result.tone}>{result.message}</ActionNotice></div>}
  </div>;
}
