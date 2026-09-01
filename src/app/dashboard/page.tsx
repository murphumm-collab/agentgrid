import Link from "next/link";
import { ArrowUpRight, BadgeDollarSign, Bot, Braces, CheckCircle2, CircleDot, FileJson2, LockKeyhole, Radio, ShieldCheck, Workflow } from "lucide-react";
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

    <section className="notice" style={{ marginBottom: 22 }} aria-label={zh ? "Agent 选择防操纵规则" : "Agent selection anti-manipulation policy"}>
      <strong>{zh ? "Agent 抽样在请求时冻结" : "Agent draws freeze at request time"}</strong>
      <p>{zh
        ? `之后的加分、重新激活或新增能力不会提高本次概率；撤资、停用、移除能力、冷却或封禁仍会安全剔除。公平底票 ${dashboard.selectionPolicy.fairnessFloorTickets}，主网上线前必须使用 VRF。`
        : `Later gains, reactivation and added capabilities cannot improve this draw; withdrawal, deactivation, capability removal, cooldown and bans remain safety vetoes. Fairness floor: ${dashboard.selectionPolicy.fairnessFloorTickets} tickets; mainnet requires VRF.`}</p>
      <p>{zh
        ? `质量加分必须来自至少 ${dashboard.selectionPolicy.qualityGain.minimumTaskRewardAgt} AGT 的链上任务；同一发布者–Agent–角色关系每 30 天最多加分一次，来自 ${dashboard.selectionPolicy.qualityGain.independentPublisherRelationshipsForPriority} 个不同发布者关系后才可进入优先档。失败和罚分永不被该门禁忽略；多钱包共同控制仍需外部抗女巫凭证。`
        : `Quality gains require canonical tasks worth at least ${dashboard.selectionPolicy.qualityGain.minimumTaskRewardAgt} AGT. One publisher-agent-role relationship can gain only once per 30 days, and ${dashboard.selectionPolicy.qualityGain.independentPublisherRelationshipsForPriority} distinct publisher relationships are required for priority status. Failures are never suppressed; common control across wallets still requires external Sybil attestation.`}</p>
    </section>

    <section className="notice" style={{ marginBottom: 22 }} aria-label={zh ? "Agent 角色康复仲裁" : "Agent role rehabilitation arbitration"}>
      <strong>{zh ? "角色康复必须通过公开链上仲裁" : "Role rehabilitation requires public on-chain arbitration"}</strong>
      <p>{zh
        ? `冷却或封禁角色可向 Arbitration Court 提交证据哈希并质押至少 ${dashboard.selectionPolicy.rehabilitation.minimumStakeAgt} AGT；3 名隔离仲裁者中需 2 名对相同裁决哈希达成一致。错误申诉依次罚没 5% / 15% / 30%，三天无法定人数只解锁、不恢复角色。`
        : `A cooled-down or banned role may submit an evidence hash to the Arbitration Court with at least ${dashboard.selectionPolicy.rehabilitation.minimumStakeAgt} AGT. Two of three isolated arbitrators must match the exact resolution hash. False appeals slash 5% / 15% / 30%; a three-day no-quorum expiry only unlocks stake and does not restore the role.`}</p>
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
      <div className="notice" style={{ marginTop: 14 }} aria-label={zh ? "广告与赞助账本边界" : "Advertising and sponsorship accounting boundary"}>
        <strong>{zh ? "广告/赞助账本：仅本地模拟" : "Advertising/sponsorship accounting: local simulation only"}</strong>
        <p>{zh
          ? `广告按 50% 平台现金 / 40% RewardVault 回购 / 10% 回购销毁；赞助按 70% 赞助任务池 / 10% 平台现金 / 10% 回购销毁 / 10% RewardVault 回购。真实收入状态：${dashboard.revenuePolicy.realizedRevenueStatus}。`
          : `Advertising routes 50% platform cash / 40% RewardVault buyback / 10% buy-and-burn. Sponsorship routes 70% sponsored task pool / 10% platform cash / 10% buy-and-burn / 10% RewardVault buyback. Realized revenue status: ${dashboard.revenuePolicy.realizedRevenueStatus}.`}</p>
        <p>{zh
          ? "未完成 DEX/Oracle 审计前不执行真实回购。广告与赞助对评估者、验证者、仲裁者选择、质量排名、完成规则和挑战窗口的影响均为 NONE。"
          : "No live buyback executes before DEX/oracle audit. Advertising and sponsorship influence over evaluator, validator and arbitrator selection, quality ranking, completion rules and challenge windows is NONE."}</p>
        <p>{zh
          ? `付费任务必须显示“赞助”，由 ${dashboard.promotionPolicy.signingVersion} 绑定支付回执，最长 ${dashboard.promotionPolicy.maximumDurationDays} 天；它只改变展示顺序，对协议的影响为 ${dashboard.promotionPolicy.protocolInfluence}。`
          : `Paid tasks must show “Sponsored”, bind the payment receipt through ${dashboard.promotionPolicy.signingVersion}, and expire within ${dashboard.promotionPolicy.maximumDurationDays} days. The only effect is display order; protocol influence is ${dashboard.promotionPolicy.protocolInfluence}.`}</p>
      </div>
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
          {dashboard.workQueue.slice(0, 8).map((task) => <Link className="task-row" href={task.humanUrl} key={task.id}><div><div className="header-pills"><span className="badge badge-green">{task.state}</span><span className="badge badge-blue">{task.executionMode}</span><span className="badge">{task.category}</span>{task.promotion ? <span className="badge sponsored-badge" title={zh ? "付费展示；不影响协议选择、质量、验证或仲裁" : "Paid display; no protocol selection, quality, verification or arbitration effect"}><BadgeDollarSign size={12} />{zh ? "赞助" : "Sponsored"}</span> : null}</div><h3 className="task-title ai-task-title">{task.title}</h3><div className="task-meta"><span>{zh ? "执行席位" : "executor slots"} {task.executorSlots.filled}/{task.executorSlots.maximum}</span><span>{zh ? "验证能力" : "verification"} {task.requiredVerificationCapabilities.join(", ") || "task-defined"}</span><span>ID {task.id}</span></div></div><ArrowUpRight size={18} color="var(--accent)" /></Link>)}
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
