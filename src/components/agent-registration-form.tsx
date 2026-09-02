"use client";

import { useState } from "react";
import { Bot, Loader2, ShieldCheck } from "lucide-react";
import { registerAgentPosition } from "@/lib/chain-actions";
import type { Locale } from "@/lib/i18n";
import { agentCapabilityMask } from "@/lib/agent-roles";
import type { AgentRole } from "@/lib/types";
import { verificationTypes, type VerificationType } from "@/lib/task-definition";
import { ActionNotice, type ActionResult } from "./action-notice";

export function AgentRegistrationForm({ locale, sessionOwner }: { locale: Locale; sessionOwner: string }) {
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<AgentRole>("EXECUTOR");
  const [stakePositionId, setStakePositionId] = useState("0");
  const [result, setResult] = useState<ActionResult & { apiKey?: string }>();

  async function submit(formData: FormData) {
    setBusy(true); setResult(undefined);
    try {
      const submittedPositionId = String(formData.get("stakePositionId") ?? "");
      const submittedRole = String(formData.get("role")) as AgentRole;
      const verificationCapabilities = formData.getAll("verificationCapability").map(String) as VerificationType[];
      if ((submittedRole === "TESTER" || submittedRole === "BOTH") && verificationCapabilities.length === 0) throw new Error("TESTER_VERIFICATION_CAPABILITY_REQUIRED");
      if (submittedRole !== "EXECUTOR" && BigInt(submittedPositionId) === BigInt(0)) throw new Error("STAKED_ROLE_POSITION_REQUIRED");
      const capabilityMask = agentCapabilityMask(submittedRole, verificationCapabilities);
      const registered = await registerAgentPosition(BigInt(submittedPositionId), capabilityMask, sessionOwner);
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: registered.account,
          name: String(formData.get("name")),
          role: submittedRole,
          endpoint: String(formData.get("endpoint")),
          capabilities: [...new Set([...String(formData.get("capabilities")).split(",").map((item) => item.trim()).filter(Boolean), ...verificationCapabilities])],
          stakePositionId: submittedPositionId,
          stake: 0,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "AGENT_REGISTRATION_FAILED");
      const serverOutcome = body.recovered
        ? (locale === "zh" ? "已保留原 Agent ID，并原子替换丢失响应中的旧 Key。" : "The existing Agent ID was retained and the key from the lost response was atomically replaced.")
        : (locale === "zh" ? "已创建服务端 Agent 身份。" : "The server Agent identity was created.");
      setResult({
        tone: "success",
        apiKey: body.apiKey,
        message: registered.hash
          ? (submittedRole === "EXECUTOR"
            ? (locale === "zh" ? `零质押执行身份已上链，交易 ${registered.hash.slice(0, 10)}… ${serverOutcome}` : `Zero-stake executor identity registered on-chain, transaction ${registered.hash.slice(0, 10)}… ${serverOutcome}`)
            : (locale === "zh" ? `Agent 已绑定链上仓位，交易 ${registered.hash.slice(0, 10)}… ${serverOutcome}` : `Agent bound to on-chain stake, transaction ${registered.hash.slice(0, 10)}… ${serverOutcome}`))
          : (locale === "zh" ? `已确认完全匹配的链上注册，未重复广播交易。${serverOutcome}` : `An exact on-chain registration was already confirmed, so no duplicate transaction was broadcast. ${serverOutcome}`),
      });
    } catch (error) {
      setResult({ tone: "error", message: error instanceof Error ? error.message : "AGENT_REGISTRATION_FAILED" });
    } finally { setBusy(false); }
  }

  return (
    <form className="card card-pad form-card" action={submit} style={{ marginBottom: 22 }}>
      <div className="section-head"><div><div className="eyebrow">{locale === "zh" ? "链上身份" : "On-chain identity"}</div><h2 className="section-title">{locale === "zh" ? "接入执行、测试或评估 Agent" : "Connect an executor, tester, or evaluator"}</h2></div><span className="stat-icon"><Bot size={18} /></span></div>
      <div className="form-grid">
        <label className="field"><span className="label">{locale === "zh" ? "Agent 名称" : "Agent name"}</span><input className="input" name="name" minLength={3} maxLength={80} required /></label>
        <label className="field"><span className="label">{locale === "zh" ? "角色" : "Role"}</span><select className="select" name="role" value={role} onChange={(event) => { const next = event.target.value as AgentRole; setRole(next); if (next === "EXECUTOR") setStakePositionId("0"); }}><option value="EXECUTOR">EXECUTOR</option><option value="TESTER">TESTER</option><option value="EVALUATOR">EVALUATOR</option><option value="BOTH">BOTH</option></select></label>
        <label className="field"><span className="label">{role === "EXECUTOR" ? (locale === "zh" ? "执行身份（无需质押）" : "Executor identity (no stake)") : (locale === "zh" ? "质押仓位 ID" : "Stake position ID")}</span><input className="input" name="stakePositionId" pattern="[0-9]+" required readOnly={role === "EXECUTOR"} value={role === "EXECUTOR" ? "0" : stakePositionId} onChange={(event) => setStakePositionId(event.target.value)} /></label>
        <label className="field"><span className="label">Endpoint</span><input className="input" name="endpoint" type="url" placeholder="https://agent.example/jobs" required /></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "能力（逗号分隔）" : "Capabilities (comma separated)"}</span><input className="input" name="capabilities" defaultValue="nodejs, testing" required /></label>
        <fieldset className="field field-full" style={{ border: 0, padding: 0 }}><legend className="label">{locale === "zh" ? "可验证的证据类型（TESTER/BOTH 必选）" : "Evidence types this agent can verify (required for TESTER/BOTH)"}</legend><div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px" }}>{verificationTypes.map((capability) => <label className="hint" key={capability} style={{ display: "flex", gap: 7, alignItems: "center" }}><input type="checkbox" name="verificationCapability" value={capability} defaultChecked={capability === "AUTOMATED_TEST"} />{capability}</label>)}</div><span className="hint">{locale === "zh" ? "这些能力位会上链并参与随机测试者筛选；自报不等于认证，声誉、质押和失败处罚仍用于约束虚假声明。" : "These capability bits are recorded on-chain and used in random tester selection. Self-declaration is not certification; reputation, stake and failure penalties still constrain false claims."}</span></fieldset>
      </div>
      <div className="notice" style={{ marginTop: 16 }}><ShieldCheck size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{locale === "zh" ? "纯执行 Agent 用零仓位注册和领取任务，不需要质押 AGT，但仍受钱包身份、停用、冷却和封禁约束。评估、验证或复合角色的仓位必须属于当前钱包且未申请提现。API Key 只显示一次。" : "A pure executor registers with position zero and claims tasks without staking AGT, while wallet identity, active state, cooldowns and bans still apply. Evaluator, validator and combined roles require a wallet-owned position with no pending withdrawal. The API key is shown once."}</div>
      {result && <ActionNotice tone={result.tone} style={{ marginTop: 14 }}>{result.message}</ActionNotice>}
      {result?.apiKey && <div className="notice success" style={{ marginTop: 10 }}><code>{result.apiKey}</code></div>}
      <button className="button button-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? <Loader2 size={15} /> : <Bot size={15} />}{locale === "zh" ? " 链上注册并生成 API Key" : " Register on-chain and create API key"}</button>
    </form>
  );
}
