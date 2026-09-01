import Link from "next/link";
import { Activity, ArrowUpRight, Bot, Braces, Clock3, Coins, ListChecks, ShieldCheck } from "lucide-react";
import { protocolSnapshot } from "@/lib/service";
import { formatToken, formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { t } from "@/lib/i18n";
import { taskCategoryLabel } from "@/components/task-category";
import { getLocale } from "@/lib/i18n-server";
import { isPublicTask } from "@/lib/public-task-view";
import { REWARD_SPLIT_BPS } from "@/lib/protocol";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const snapshot = await protocolSnapshot();
  const locale = await getLocale();
  const stats = [
    { label: t(locale, "totalStaked"), value: `${formatToken(snapshot.stats.lockedStake)} AGT`, note: t(locale, "lockedWork"), icon: Coins },
    { label: t(locale, "activeTasks"), value: snapshot.stats.activeTasks, note: t(locale, "buildMaintenance"), icon: ListChecks },
    { label: t(locale, "onlineAgents"), value: snapshot.stats.onlineAgents, note: t(locale, "agentPool"), icon: Bot },
    { label: t(locale, "rewardReserve"), value: `${formatToken(snapshot.stats.rewardReserve)} AGT`, note: `${t(locale, "epoch")} ${snapshot.config.epochId}`, icon: ShieldCheck },
  ];
  const utilization = (snapshot.stats.issuedRewards / snapshot.config.epochRewardBudget) * 100;
  const publicTasks = snapshot.tasks.filter(isPublicTask);
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{t(locale, "protocolOverview")}</div><h1>{t(locale, "usefulWork")}</h1><p className="lead">{t(locale, "overviewLead")}</p></div>
        <div className="header-pills"><Link className="button button-secondary" href="/dashboard">AI Dashboard <Braces size={15} /></Link><Link className="button button-primary" href="/tasks/new">{t(locale, "publishTask")} <ArrowUpRight size={15} /></Link></div>
      </div>
      <div className="grid stats-grid">
        {stats.map(({ label, value, note, icon: Icon }) => <div className="card stat-card" key={label}><div className="stat-head"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>)}
      </div>
      <div className="grid two-col">
        <section className="card card-pad">
          <div className="section-head"><h2 className="section-title">{t(locale, "liveWork")}</h2><Link href="/tasks" className="section-link">{t(locale, "viewAll")}</Link></div>
          <div className="task-list">
            {publicTasks.slice(0, 5).map((task) => (
              <Link className="task-row" href={`/tasks/${task.id}`} key={task.id}>
                <div><h3 className="task-title">{task.title}</h3><div className="task-meta"><span>{taskCategoryLabel(task.category, locale)}</span><span><Clock3 size={11} style={{ verticalAlign: "middle" }} /> {task.declaredDurationHours}h</span><span>{t(locale, "created")} {formatDate(task.createdAt, locale)}</span></div></div>
                <div className="task-side"><StatusBadge state={task.state} locale={locale} /><span className="reward">{t(locale, "upTo")} {formatToken((snapshot.positions.find((p) => p.id === task.stakePositionId)?.amount ?? 0) * snapshot.config.rewardCapRatio)} AGT</span></div>
              </Link>
            ))}
          </div>
        </section>
        <aside className="card card-pad allocation">
          <div><div className="eyebrow">{t(locale, "epochAllocation")}</div><p className="allocation-total">{formatToken(snapshot.config.epochRewardBudget)} <span style={{ fontSize: 14, color: "var(--muted)" }}>AGT</span></p><p className="lead" style={{ fontSize: 12 }}>{t(locale, "fixedBudget")}</p></div>
          <div><div className="section-head" style={{ marginBottom: 9 }}><span className="topbar-label">{t(locale, "issued")}</span><strong style={{ fontSize: 12 }}>{utilization.toFixed(1)}%</strong></div><div className="progress-track"><div className="progress-bar" style={{ width: `${Math.max(2, utilization)}%` }} /></div></div>
          <div className="legend">
            <div className="legend-item"><span className="legend-dot" style={{ "--dot": "#52e692" } as React.CSSProperties} />{t(locale, "executors")} {REWARD_SPLIT_BPS.executors / 100}%</div>
            <div className="legend-item"><span className="legend-dot" style={{ "--dot": "#60a5fa" } as React.CSSProperties} />{t(locale, "testers")} {REWARD_SPLIT_BPS.tester / 100}%</div>
            <div className="legend-item"><span className="legend-dot" style={{ "--dot": "#64748b" } as React.CSSProperties} />{t(locale, "reserve")} {REWARD_SPLIT_BPS.reserve / 100}%</div>
          </div>
          <div className="notice"><Activity size={14} style={{ verticalAlign: "middle", marginRight: 8 }} />{t(locale, "issuanceProofNotice")}</div>
        </aside>
      </div>
    </>
  );
}
