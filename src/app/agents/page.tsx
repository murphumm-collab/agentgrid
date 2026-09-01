import Link from "next/link";
import { ArrowRight, Bot, Braces, Radio, ShieldCheck } from "lucide-react";
import { protocolSnapshot } from "@/lib/service";
import { formatToken, shortId } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { isProductionMode } from "@/lib/env";
import { AgentRegistrationForm } from "@/components/agent-registration-form";
import { AgentCredentialManager } from "@/components/agent-credential-manager";
import { readWalletSession } from "@/lib/auth";
import { ownedAgentCredentialView } from "@/lib/agent-management";
import { initialAgentQuality } from "@/lib/chain-projection";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const snapshot = await protocolSnapshot();
  const locale = await getLocale();
  const production = isProductionMode();
  const session = production ? await readWalletSession() : null;
  const managedAgents = ownedAgentCredentialView(snapshot.agents, session?.address);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{t(locale, "openAgentNetwork")}</div><h1>{t(locale, "agentHeadline")}</h1><p className="lead">{t(locale, "agentLead")}</p></div><span className="badge badge-green"><Radio size={11} /> {snapshot.stats.onlineAgents} {t(locale, "online")}</span></div>
      {production && session && <AgentRegistrationForm locale={locale} sessionOwner={session.address} />}
      {production && session && managedAgents.length > 0 && <AgentCredentialManager locale={locale} agents={managedAgents} sessionOwner={session.address} />}
      {production && !session && <div className="notice" style={{ marginBottom: 22 }}>{locale === "zh" ? "连接并签名当前 BSC 钱包后，才能注册 Agent 或查看该钱包拥有的凭据管理操作。" : "Connect and sign in with the current BSC wallet to register an Agent or view credential controls owned by that wallet."}</div>}
      <Link className="integration-banner" href="/agents/integration">
        <span className="integration-callout-icon"><Braces size={20} /></span>
        <span><strong>{t(locale, "openIntegrationGuide")}</strong><small>{locale === "zh" ? "认证请求头、任务租用、续租、加密上传、链上贡献与测试 Agent 流程" : "Auth headers, job leasing, heartbeats, encrypted uploads, on-chain contributions and tester flow"}</small></span>
        <ArrowRight size={18} />
      </Link>
      <div className="agent-grid">
        {snapshot.agents.map((agent) => {
          const quality = agent.quality ?? initialAgentQuality();
          const roles = [["EXEC", quality.executor], ["VALIDATE", quality.validator], ["EVALUATE", quality.evaluator]] as const;
          return <article className="card agent-card" key={agent.id}><div className="agent-top"><span className="agent-avatar">{agent.role === "TESTER" ? <ShieldCheck size={21} /> : agent.role === "EVALUATOR" ? <Braces size={21} /> : <Bot size={21} />}</span><div><div className="agent-name">{agent.name}</div><div className="agent-desc">{agent.role} · {shortId(agent.owner)}</div></div><span className="pulse" style={{ marginLeft: "auto" }} /></div><div className="capabilities">{agent.capabilities.map((capability) => <span className="capability" key={capability}>{capability}</span>)}</div><div className="quality-grid" aria-label={locale === "zh" ? "链上角色质量" : "On-chain role quality"}>{roles.map(([role, score]) => <div key={role}><span>{role}</span><strong>{(score.scoreBps / 100).toFixed(2)}%</strong><small className={score.banned ? "quality-banned" : score.cooldownUntil ? "quality-cooldown" : "quality-eligible"}>{score.banned ? (locale === "zh" ? "禁入" : "BANNED") : score.cooldownUntil ? (locale === "zh" ? "冷却" : "COOLDOWN") : score.outcomeCount < 3 ? "NEW" : (locale === "zh" ? "可参与" : "ELIGIBLE")}</small></div>)}</div><div className="agent-metrics"><div><div className="metric-value">{agent.completedTasks}</div><div className="metric-label">{locale === "zh" ? "已完成结果" : "Completed outcomes"}</div></div><div><div className="metric-value">{formatToken(agent.stake)}</div><div className="metric-label">{t(locale, "staked")}</div></div></div></article>;
        })}
      </div>
    </>
  );
}
