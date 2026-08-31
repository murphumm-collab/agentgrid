"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Coins, Droplets } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { createStakeAndCredit } from "@/lib/chain-actions";

export function StakeForm({ locale, owner, production }: { locale: Locale; owner: string; production: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    setMessage(response.ok ? t(locale, "transactionCompleted") : data.error ?? t(locale, "transactionFailed"));
    if (response.ok) router.refresh();
  }

  async function stakeOnChain(data: FormData) {
    setBusy(true); setMessage(null);
    try {
      const result = await createStakeAndCredit(String(data.get("amount")));
      setMessage(`${t(locale, "transactionCompleted")} · Position #${result.positionId}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t(locale, "transactionFailed"));
    } finally { setBusy(false); }
  }

  return (
    <div className="grid two-col">
      <form className="card card-pad" action={production ? stakeOnChain : (data) => call("/api/stake", { owner, amount: Number(data.get("amount")) })}>
        <div className="section-head"><div><div className="eyebrow">{t(locale, "newPosition")}</div><h2 className="section-title">{t(locale, "lockSlot")}</h2></div><span className="stat-icon"><Coins size={18} /></span></div>
        <label className="field"><span className="label">{t(locale, "amountStake")}</span><input className="input" name="amount" type="number" min="1000" defaultValue="2500" /><span className="hint">{t(locale, "minimumStake")}</span></label>
        <button className="button button-primary" style={{ marginTop: 18 }} disabled={busy || (production && !owner)}>{busy ? "Confirming…" : t(locale, "createPosition")}</button>
      </form>
      {!production && <div className="card card-pad">
        <div className="section-head"><div><div className="eyebrow">{t(locale, "testnet")}</div><h2 className="section-title">{t(locale, "needTokens")}</h2></div><span className="stat-icon"><Droplets size={18} /></span></div>
        <p className="lead" style={{ fontSize: 13 }}>{t(locale, "faucetHint")}</p>
        <button className="button button-secondary" style={{ marginTop: 18 }} onClick={() => call("/api/faucet", { owner, amount: 10000 })}>{t(locale, "requestTokens")}</button>
      </div>}
      {message && <div className={`notice ${message === t(locale, "transactionCompleted") ? "success" : "error"}`} style={{ gridColumn: "1 / -1" }}>{message}</div>}
    </div>
  );
}
