"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Droplets } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { createStakeAndCredit } from "@/lib/chain-actions";
import { ActionNotice, type ActionResult } from "./action-notice";

export function StakeForm({ locale, owner, production }: { locale: Locale; owner: string; production: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function call(path: string, body: unknown) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setResult(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => null) as { error?: unknown } | null;
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : t(locale, "transactionFailed"));
      setResult({ tone: "success", message: t(locale, "transactionCompleted") });
      router.refresh();
    } catch (error) {
      setResult({ tone: "error", message: error instanceof Error ? error.message : t(locale, "transactionFailed") });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function stakeOnChain(data: FormData) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setResult(null);
    try {
      const result = await createStakeAndCredit(String(data.get("amount")));
      setResult({ tone: "success", message: `${t(locale, "transactionCompleted")} · Position #${result.positionId}` });
      router.refresh();
    } catch (error) {
      setResult({ tone: "error", message: error instanceof Error ? error.message : t(locale, "transactionFailed") });
    } finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <div className="grid two-col">
      <form className="card card-pad" action={production ? stakeOnChain : (data) => call("/api/stake", { owner, amount: Number(data.get("amount")) })}>
        <div className="section-head"><div><div className="eyebrow">{t(locale, "newPosition")}</div><h2 className="section-title">{t(locale, "lockSlot")}</h2></div><span className="stat-icon"><Coins size={18} /></span></div>
        <label className="field"><span className="label">{t(locale, "amountStake")}</span><input className="input" name="amount" type="number" min="1000" defaultValue="2500" /><span className="hint">{t(locale, "minimumStake")}</span></label>
        <button type="submit" className="button button-primary" style={{ marginTop: 18 }} disabled={busy || (production && !owner)} aria-busy={busy}>{busy ? "Confirming…" : t(locale, "createPosition")}</button>
      </form>
      {!production && <div className="card card-pad">
        <div className="section-head"><div><div className="eyebrow">{t(locale, "testnet")}</div><h2 className="section-title">{t(locale, "needTokens")}</h2></div><span className="stat-icon"><Droplets size={18} /></span></div>
        <p className="lead" style={{ fontSize: 13 }}>{t(locale, "faucetHint")}</p>
        <button type="button" className="button button-secondary" style={{ marginTop: 18 }} disabled={busy} aria-busy={busy} onClick={() => void call("/api/faucet", { owner, amount: 10000 })}>{busy ? "Confirming…" : t(locale, "requestTokens")}</button>
      </div>}
      {result && <ActionNotice tone={result.tone} style={{ gridColumn: "1 / -1" }}>{result.message}</ActionNotice>}
    </div>
  );
}
