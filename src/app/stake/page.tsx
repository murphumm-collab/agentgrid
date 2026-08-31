import { Coins, LockKeyhole, TicketCheck } from "lucide-react";
import { protocolSnapshot } from "@/lib/service";
import { StakeForm } from "@/components/stake-form";
import { formatDate, formatToken, shortId } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { readWalletSession } from "@/lib/auth";
import { isProductionMode } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function StakePage() {
  const snapshot = await protocolSnapshot();
  const locale = await getLocale();
  const production = isProductionMode();
  const owner = production ? (await readWalletSession())?.address ?? "" : "0xDemoPublisher";
  const positions = snapshot.positions.filter((position) => position.owner === owner);
  const balance = snapshot.ledger.filter((entry) => entry.owner === owner).reduce((sum, entry) => sum + entry.amount, 0);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{t(locale, "publishingCapacity")}</div><h1>{t(locale, "stakeHeadline")}</h1><p className="lead">{t(locale, "stakeLead")}</p></div><div className="wallet-pill"><Coins size={14} color="var(--accent)" />{formatToken(balance)} AGT {t(locale, "available")}</div></div>
      <StakeForm locale={locale} owner={owner} production={production} />
      <section className="card card-pad" style={{ marginTop: 22 }}><div className="section-head"><h2 className="section-title">{t(locale, "yourPositions")}</h2><span className="badge">{positions.length} {t(locale, "positions")}</span></div><div className="task-list">{positions.map((position) => <div className="task-row" key={position.id}><div><h3 className="task-title">{t(locale, "position")} {shortId(position.id)}</h3><div className="task-meta"><span><LockKeyhole size={11} /> {formatToken(position.amount)} AGT {t(locale, "locked")}</span><span><TicketCheck size={11} /> {position.activeTaskId ? t(locale, "creditConsumed") : position.creditExpiresAt ? `${t(locale, "creditExpires")} ${formatDate(position.creditExpiresAt, locale)}` : t(locale, "creditAfterCompletion")}</span></div></div><div className="task-side"><span className={`badge ${position.activeTaskId ? "badge-blue" : "badge-green"}`}>{position.activeTaskId ? t(locale, "taskActive") : t(locale, "idle")}</span></div></div>)}</div></section>
    </>
  );
}
