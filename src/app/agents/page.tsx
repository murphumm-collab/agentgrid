import Link from "next/link";
import { ArrowRight, Bot, Braces, Radio, ShieldCheck } from "lucide-react";
import { protocolSnapshot } from "@/lib/service";
import { formatToken, shortId } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { isProductionMode } from "@/lib/env";
import { AgentRegistrationForm } from "@/components/agent-registration-form";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const snapshot = await protocolSnapshot();
  const locale = await getLocale();
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{t(locale, "openAgentNetwork")}</div><h1>{t(locale, "agentHeadline")}</h1><p className="lead">{t(locale, "agentLead")}</p></div><span className="badge badge-green"><Radio size={11} /> {snapshot.stats.onlineAgents} {t(locale, "online")}</span></div>
      {isProductionMode() && <AgentRegistrationForm locale={locale} />}
      <Link className="integration-banner" href="/agents/integration">
        <span className="integration-callout-icon"><Braces size={20} /></span>
        <span><strong>{t(locale, "openIntegrationGuide")}</strong><small>{locale === "zh" ? "认证请求头、任务租用、续租、加密上传、链上贡献与测试 Agent 流程" : "Auth headers, job leasing, heartbeats, encrypted uploads, on-chain contributions and tester flow"}</small></span>
        <ArrowRight size={18} />
      </Link>
      <div className="agent-grid">
        {snapshot.agents.map((agent) => <article className="card agent-card" key={agent.id}><div className="agent-top"><span className="agent-avatar">{agent.role === "TESTER" ? <ShieldCheck size={21} /> : agent.role === "EVALUATOR" ? <Braces size={21} /> : <Bot size={21} />}</span><div><div className="agent-name">{agent.name}</div><div className="agent-desc">{agent.role} · {shortId(agent.owner)}</div></div><span className="pulse" style={{ marginLeft: "auto" }} /></div><div className="capabilities">{agent.capabilities.map((capability) => <span className="capability" key={capability}>{capability}</span>)}</div><div className="agent-metrics"><div><div className="metric-value">{agent.reputation}%</div><div className="metric-label">{t(locale, "reputation")}</div></div><div><div className="metric-value">{formatToken(agent.stake)}</div><div className="metric-label">{t(locale, "staked")}</div></div></div></article>)}
      </div>
    </>
  );
}
