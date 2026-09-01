import Link from "next/link";
import { ArrowUpRight, BriefcaseBusiness, FileCheck2, ShieldCheck, Trophy } from "lucide-react";
import { protocolSnapshot } from "@/lib/service";
import { isPublicTask, publicTaskStatistics } from "@/lib/public-task-view";
import { getLocale } from "@/lib/i18n-server";
import { formatDate, formatToken } from "@/lib/format";
import { taskCategoryLabel } from "@/components/task-category";

export const dynamic = "force-dynamic";

export default async function CompletedProofsPage() {
  const snapshot = await protocolSnapshot();
  const locale = await getLocale();
  const statistics = publicTaskStatistics(snapshot.tasks, snapshot.rewards);
  const rewards = new Map(snapshot.rewards.map((reward) => [reward.taskId, reward]));
  const completed = snapshot.tasks.filter((task) => task.state === "COMPLETED" && isPublicTask(task))
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt) || b.id.localeCompare(a.id));
  const percent = statistics.settledCompletionRate == null ? "—" : `${(statistics.settledCompletionRate * 100).toFixed(1)}%`;
  const cards = [
    { label: locale === "zh" ? "已完成任务" : "Completed tasks", value: statistics.completedTasks, icon: Trophy },
    { label: locale === "zh" ? "独立验证" : "Independently verified", value: statistics.independentlyVerifiedTasks, icon: ShieldCheck },
    { label: locale === "zh" ? "真实业务采用" : "Business adoptions", value: statistics.businessAdoptionAttestations, icon: BriefcaseBusiness },
    { label: locale === "zh" ? "已结算完成率" : "Settled completion rate", value: percent, icon: FileCheck2 },
  ];
  return <>
    <div className="page-head"><div><div className="eyebrow">PUBLIC PROOF INDEX</div><h1>{locale === "zh" ? "已完成任务与验证统计" : "Completed work and verification statistics"}</h1><p className="lead">{locale === "zh" ? "公开页只展示任务定义、成果承诺、逐条验收证据哈希、奖励与业务采用证明；不会展示下载地址、密钥、隐藏测试、原始日志或 Agent 私有接口。" : "This public index exposes definitions, artifact commitments, criterion-level evidence hashes, rewards and adoption proofs—never download URLs, keys, hidden tests, raw logs or private Agent endpoints."}</p></div><a className="button" href="/api/public/tasks/completed">JSON API <ArrowUpRight size={15} /></a></div>
    <div className="grid stats-grid">{cards.map(({ label, value, icon: Icon }) => <div className="card stat-card" key={label}><div className="stat-head"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><div className="stat-value">{value}</div></div>)}</div>
    <section className="card card-pad"><div className="section-head"><h2 className="section-title">{locale === "zh" ? "可公开核验的完成记录" : "Publicly verifiable completion records"}</h2><span className="badge badge-green">{completed.length} {locale === "zh" ? "条" : "records"}</span></div>
      {completed.length ? <div className="task-list">{completed.map((task) => {
        const reward = rewards.get(task.id);
        const criterionResults = task.testResult?.criterionResults ?? [];
        const passedCriteria = criterionResults.filter((result) => result.passed).length;
        return <Link className="task-row" href={`/tasks/${task.id}`} key={task.id}><div><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}><span className="badge badge-green">COMPLETED</span><span className="badge badge-blue">{taskCategoryLabel(task.category, locale)}</span>{task.businessAdoption && <span className="badge"><BriefcaseBusiness size={11} /> {locale === "zh" ? "已采用" : "adopted"}</span>}</div><h3 className="task-title">{task.title}</h3><div className="task-meta"><span>{locale === "zh" ? "完成" : "completed"} {task.completedAt ? formatDate(task.completedAt, locale) : (locale === "zh" ? "链上时间待回填" : "chain time unavailable")}</span><span>{task.executionMode}</span><span>{locale === "zh" ? "验收标准" : "criteria"} {passedCriteria}/{criterionResults.length || task.completionDefinition?.acceptanceCriteria.length || task.criteria.length}</span><span>{locale === "zh" ? "报告" : "report"} {task.testResult?.reportHash ? `${task.testResult.reportHash.slice(0, 10)}…` : "—"}</span></div></div><div className="task-side"><strong className="reward">{formatToken(reward?.total ?? 0)} AGT</strong><ArrowUpRight size={18} /></div></Link>;
      })}</div> : <div className="category-empty"><FileCheck2 size={24} /><strong>{locale === "zh" ? "还没有完成记录" : "No completed records yet"}</strong><span>{locale === "zh" ? "只有完成 90 天维护检查的任务才会进入此公开索引。" : "Only tasks completing the 90-day maintenance checkpoint enter this public index."}</span></div>}
    </section>
  </>;
}
