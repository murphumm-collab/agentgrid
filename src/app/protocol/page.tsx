import { Activity, Coins, Fingerprint, ShieldCheck } from "lucide-react";
import { protocolSnapshot } from "@/lib/service";
import { formatDate, formatToken, shortId } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function ProtocolPage() {
  const snapshot = await protocolSnapshot();
  const locale = await getLocale();
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{t(locale, "transparentLedger")}</div><h1>{t(locale, "rewardHeadline")}</h1><p className="lead">{t(locale, "rewardLead")}</p></div><span className="badge badge-green"><ShieldCheck size={11} /> {t(locale, "validationActive")}</span></div>
      <div className="grid stats-grid">
        <div className="card stat-card"><div className="stat-head">{t(locale, "epochBudget")}<span className="stat-icon"><Coins size={17} /></span></div><div className="stat-value">{formatToken(snapshot.config.epochRewardBudget)}</div><div className="stat-note">{t(locale, "fixedReserve")}</div></div>
        <div className="card stat-card"><div className="stat-head">{t(locale, "issued")}<span className="stat-icon"><Activity size={17} /></span></div><div className="stat-value">{formatToken(snapshot.config.epochRewardIssued)}</div><div className="stat-note">{t(locale, "lifecycleGrants")}</div></div>
        <div className="card stat-card"><div className="stat-head">{t(locale, "rewardCap")}<span className="stat-icon"><ShieldCheck size={17} /></span></div><div className="stat-value">{snapshot.config.rewardCapRatio * 100}%</div><div className="stat-note">{t(locale, "publisherStake")}</div></div>
        <div className="card stat-card"><div className="stat-head">{t(locale, "ledgerProofs")}<span className="stat-icon"><Fingerprint size={17} /></span></div><div className="stat-value">{snapshot.ledger.length}</div><div className="stat-note">{t(locale, "movementRecords")}</div></div>
      </div>
      <section className="card card-pad"><div className="section-head"><h2 className="section-title">{t(locale, "tokenLedger")}</h2><span className="badge">{t(locale, "appendOnly")}</span></div><div className="task-list">{[...snapshot.ledger].reverse().map((entry) => <div className="task-row" key={entry.id}><div><h3 className="task-title">{entry.type} · {shortId(entry.owner)}</h3><div className="task-meta"><span>{formatDate(entry.createdAt, locale)}</span><span><Fingerprint size={11} /> {shortId(entry.proof)}</span>{entry.taskId && <span>{t(locale, "task")} {shortId(entry.taskId)}</span>}</div></div><div className={`reward`} style={{ color: entry.amount >= 0 ? "var(--accent)" : "var(--danger)" }}>{entry.amount >= 0 ? "+" : ""}{formatToken(entry.amount)} AGT</div></div>)}</div></section>
    </>
  );
}
