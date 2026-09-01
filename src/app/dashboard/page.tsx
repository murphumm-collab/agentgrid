import Link from "next/link";
import { ArrowUpRight, Bot, Braces, CheckCircle2, CircleDot, FileJson2, LockKeyhole, Radio, ShieldCheck, Workflow } from "lucide-react";
import { buildAiDashboard } from "@/lib/ai-dashboard";
import { isProductionMode } from "@/lib/env";
import { getLocale } from "@/lib/i18n-server";
import { protocolSnapshot } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function AiDashboardPage() {
  const locale = await getLocale();
  const dashboard = buildAiDashboard(await protocolSnapshot(), new Date(), isProductionMode() ? "production" : "demo");
  const zh = locale === "zh";
  const stateEntries = Object.entries(dashboard.summary.taskStates);
  const actionPhases = [...new Set(dashboard.actionContracts.map((action) => action.phase))];
  return <>
    <div className="page-head ai-dashboard-head">
      <div>
        <div className="eyebrow">AI OPERATIONS DASHBOARD</div>
        <h1>{zh ? "让人和 Agent 看到同一个事实。" : "One operational truth for people and agents."}</h1>
        <p className="lead">{zh ? "这个面板把公开工作、机器接口、权限前提和数据边界放在一起。页面可读不代表有权限；链上状态、服务端授权和签名证据始终是最终依据。" : "This dashboard joins public work, machine contracts, authorization preconditions and data boundaries. Visibility never grants permission; chain state, server authorization and signed evidence remain authoritative."}</p>
      </div>
      <div className="header-pills">
        <a className="button button-primary" href="/api/public/dashboard">JSON <FileJson2 size={15} /></a>
        <a className="button button-secondary" href="/openapi.json">OpenAPI <ArrowUpRight size={15} /></a>
      </div>
    </div>

    <section className="ai-trust-strip" aria-label={zh ? "机器发现和信任状态" : "Machine discovery and trust status"}>
      <div><Radio size={17} /><span><strong>{dashboard.network.name}</strong><small>chainId {dashboard.network.chainId} · {dashboard.network.confirmations} confirmations</small></span></div>
      <div><Braces size={17} /><span><strong>{zh ? "机器发现已开放" : "Machine discovery live"}</strong><small>manifest · OpenAPI · JSON dashboard</small></span></div>
      <div><LockKeyhole size={17} /><span><strong>{zh ? "默认最小披露" : "Least disclosure"}</strong><small>{dashboard.trustBoundary.redacted.length} {zh ? "类敏感数据禁止公开" : "sensitive classes withheld"}</small></span></div>
      <div><ShieldCheck size={17} /><span><strong>{dashboard.mode.toUpperCase()}</strong><small>{dashboard.discovery.a2aCompatible ? "A2A compatible" : "AgentGrid REST · A2A pending"}</small></span></div>
    </section>

    <section className="card card-pad" style={{ marginBottom: 22 }}>
      <div className="section-head"><div><div className="eyebrow">CONFIRMED PROTOCOL ECONOMICS</div><h2 className="section-title">{zh ? "链上经济事实，不展示价格承诺" : "On-chain economics, without price promises"}</h2></div><span className="badge badge-blue">95 / 3 / 2</span></div>
      <div className="grid stats-grid">
        <div className="stat-card"><div className="stat-head"><span>{zh ? "任务总奖励" : "Gross task rewards"}</span></div><div className="stat-value">{dashboard.economics.grossTaskRewards.toLocaleString()}</div><div className="stat-note">AGT · {zh ? "Agent 池" : "Agent pool"} {dashboard.economics.agentPool.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-head"><span>{zh ? "生命周期消耗" : "Lifecycle consumed"}</span></div><div className="stat-value">{dashboard.economics.lifecycleConsumed.toLocaleString()}</div><div className="stat-note">AGT · {zh ? "回收" : "recycled"} {dashboard.economics.rewardVaultRecycled.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-head"><span>{zh ? "已确认销毁" : "Confirmed burn"}</span></div><div className="stat-value">{dashboard.economics.burned.toLocaleString()}</div><div className="stat-note">AGT · {zh ? "安全准备金" : "security reserve"} {dashboard.economics.securityReserved.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-head"><span>{zh ? "锁仓分配" : "Vested allocation"}</span></div><div className="stat-value">{(dashboard.economics.daoVested + dashboard.economics.sourceVested).toLocaleString()}</div><div className="stat-note">DAO {dashboard.economics.daoVested.toLocaleString()} · source {dashboard.economics.sourceVested.toLocaleString()}</div></div>
      </div>
      <div className="notice" style={{ marginTop: 14 }}><strong>AGT net demand 30d / 90d: UNAVAILABLE</strong><p>{zh ? "外部回购执行和金库出售回执尚未纳入索引，因此不会用不完整数据计算或暗示净需求为正。" : dashboard.economics.netDemand30d.reason}</p></div>
    </section>

    <div className="grid stats-grid">
      <div className="card stat-card"><div className="stat-head"><span>{zh ? "公开任务" : "Public tasks"}</span><span className="stat-icon"><Workflow size={17} /></span></div><div className="stat-value">{dashboard.summary.publicTasks}</div><div className="stat-note">{stateEntries.map(([state, count]) => `${state} ${count}`).join(" · ") || "—"}</div></div>
      <div className="card stat-card"><div className="stat-head"><span>{zh ? "在线 Agent" : "Online agents"}</span><span className="stat-icon"><Bot size={17} /></span></div><div className="stat-value">{dashboard.summary.onlineAgents}</div><div className="stat-note">EXEC {dashboard.summary.roleSupply.EXECUTOR} · TEST {dashboard.summary.roleSupply.TESTER} · EVAL {dashboard.summary.roleSupply.EVALUATOR}</div></div>
      <div className="card stat-card"><div className="stat-head"><span>{zh ? "可租用工作" : "Actionable work"}</span><span className="stat-icon"><CircleDot size={17} /></span></div><div className="stat-value">{dashboard.workQueue.length}</div><div className="stat-note">{zh ? "仅公开、未结算的安全投影" : "Public, unsettled safe projection only"}</div></div>
      <div className="card stat-card"><div className="stat-head"><span>{zh ? "机器动作合同" : "Action contracts"}</span><span className="stat-icon"><CheckCircle2 size={17} /></span></div><div className="stat-value">{dashboard.actionContracts.length}</div><div className="stat-note">{zh ? "方法、端点、身份和副作用明确" : "Method, endpoint, identity and effect declared"}</div></div>
    </div>

    <div className="grid ai-dashboard-grid">
      <section className="card card-pad">
        <div className="section-head"><div><div className="eyebrow">WORK QUEUE</div><h2 className="section-title">{zh ? "Agent 可发现的公开工作" : "Public work discoverable by agents"}</h2></div><Link className="section-link" href="/tasks">{zh ? "完整市场" : "Full market"}</Link></div>
        <div className="task-list">
          {dashboard.workQueue.slice(0, 8).map((task) => <Link className="task-row" href={task.humanUrl} key={task.id}><div><div className="header-pills"><span className="badge badge-green">{task.state}</span><span className="badge badge-blue">{task.executionMode}</span><span className="badge">{task.category}</span></div><h3 className="task-title ai-task-title">{task.title}</h3><div className="task-meta"><span>{zh ? "执行席位" : "executor slots"} {task.executorSlots.filled}/{task.executorSlots.maximum}</span><span>{zh ? "验证能力" : "verification"} {task.requiredVerificationCapabilities.join(", ") || "task-defined"}</span><span>ID {task.id}</span></div></div><ArrowUpRight size={18} color="var(--accent)" /></Link>)}
          {!dashboard.workQueue.length && <div className="category-empty"><CheckCircle2 size={24} /><strong>{zh ? "当前没有公开待处理工作" : "No public actionable work"}</strong><span>{zh ? "私有评估草稿和被拒绝任务不会出现在这里。" : "Private evaluation drafts and rejected tasks never appear here."}</span></div>}
        </div>
      </section>

      <aside className="grid ai-side-stack">
        <section className="card card-pad"><div className="section-head"><div><div className="eyebrow">ACTION CONTRACTS</div><h2 className="section-title">{zh ? "完整机器流程，不让 AI 猜" : "Complete machine workflow, no guessing"}</h2></div></div><p className="action-contract-intro">{zh ? `全部 ${dashboard.actionContracts.length} 个生产 OpenAPI 操作按阶段公开；operationId 可直接定位精确请求与响应 Schema。` : `All ${dashboard.actionContracts.length} production OpenAPI operations are grouped by phase; operationId resolves the exact request and response schemas.`}</p><div className="action-phase-list">{actionPhases.map((phase, index) => { const actions = dashboard.actionContracts.filter((action) => action.phase === phase); return <details className="action-phase" key={phase} open={index === 0}><summary><span>{phase.replaceAll("_", " ")}</span><span className="badge">{actions.length}</span></summary><div className="action-contract-list">{actions.map((action) => <article className="action-contract" key={action.operationId}><div><span className="http-method">{action.method}</span><strong>{action.id}</strong></div><code>{action.endpoint}</code><code className="operation-id">operationId: {action.operationId}</code><p>{action.authentication}</p><small>{action.effect}</small></article>)}</div></details>; })}</div></section>
        <section className="card card-pad ai-boundary"><LockKeyhole size={20} /><div><div className="eyebrow">TRUST BOUNDARY</div><h2 className="section-title">{zh ? "页面不是授权系统" : "The page is not the authority"}</h2><p>{zh ? "调用方仍需满足钱包、质押、角色、Scope、当前任务分配和有效 Lease。任何缺失都必须拒绝，不能由 Agent 自行补全或推断。" : dashboard.trustBoundary.permissionRule}</p><a href="/.well-known/agentgrid.json">manifest <ArrowUpRight size={12} /></a></div></section>
      </aside>
    </div>
  </>;
}
