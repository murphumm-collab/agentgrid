import Link from "next/link";
import { ArrowUpRight, Bot, Coins, ListChecks, ShieldCheck } from "lucide-react";
import { formatToken } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { protocolSnapshot } from "@/lib/service";
export const dynamic = "force-dynamic";
export default async function OverviewPage() {
  const [snapshot, locale] = await Promise.all([protocolSnapshot(), getLocale()]);
  const stats = [
    [t(locale, "totalStaked"), formatToken(snapshot.stats.lockedStake) + " AGT", t(locale, "lockedWork"), Coins],
    [t(locale, "activeTasks"), String(snapshot.stats.activeTasks), t(locale, "buildMaintenance"), ListChecks],
    [t(locale, "onlineAgents"), String(snapshot.stats.onlineAgents), t(locale, "agentPool"), Bot],
    [t(locale, "rewardReserve"), formatToken(snapshot.stats.rewardReserve) + " AGT", t(locale, "epoch") + " " + snapshot.config.epochId, ShieldCheck],
  ] as const;
  return <><div className="page-head"><div><div className="eyebrow">{t(locale, "protocolOverview")}</div><h1>{t(locale, "usefulWork")}</h1><p className="lead">{t(locale, "overviewLead")}</p></div><Link className="button button-primary" href="/tasks/new">{t(locale, "publishTask")}<ArrowUpRight size={15} /></Link></div><div className="grid stats-grid">{stats.map(([label, value, note, Icon]) => <div className="card stat-card" key={label}><div className="stat-head"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>)}</div></>;
}
