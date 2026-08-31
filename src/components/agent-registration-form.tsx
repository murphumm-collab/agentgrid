"use client";

import { useState } from "react";
import { Bot, Loader2, ShieldCheck } from "lucide-react";
import { registerAgentPosition } from "@/lib/chain-actions";
import type { Locale } from "@/lib/i18n";
import { agentCapabilityMask } from "@/lib/agent-roles";
import type { AgentRole } from "@/lib/types";
import { verificationTypes, type VerificationType } from "@/lib/task-definition";

export function AgentRegistrationForm({ locale }: { locale: Locale }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ apiKey?: string; message: string; error?: boolean }>();

  async function submit(formData: FormData) {
    setBusy(true); setResult(undefined);
    try {
      const stakePositionId = String(formData.get("stakePositionId") ?? "");
      const role = String(formData.get("role")) as AgentRole;
      const verificationCapabilities = formData.getAll("verificationCapability").map(String) as VerificationType[];
      if ((role === "TESTER" || role === "BOTH") && verificationCapabilities.length === 0) throw new Error("TESTER_VERIFICATION_CAPABILITY_REQUIRED");
      const capabilityMask = agentCapabilityMask(role, verificationCapabilities);
      const registered = await registerAgentPosition(BigInt(stakePositionId), capabilityMask);
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: registered.account,
          name: String(formData.get("name")),
          role,
          endpoint: String(formData.get("endpoint")),
          capabilities: [...new Set([...String(formData.get("capabilities")).split(",").map((item) => item.trim()).filter(Boolean), ...verificationCapabilities])],
          stakePositionId,
          stake: 0,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "AGENT_REGISTRATION_FAILED");
      setResult({
        apiKey: body.apiKey,
        message: locale === "zh" ? `Agent 已绑定链上仓位，交易 ${registered.hash.slice(0, 10)}…` : `Agent bound to on-chain stake, transaction ${registered.hash.slice(0, 10)}…`,
      });
    } catch (error) {
      setResult({ message: error instanceof Error ? error.message : "AGENT_REGISTRATION_FAILED", error: true });
    } finally { setBusy(false); }
  }

  return (
    <form className="card card-pad form-card" action={submit} style={{ marginBottom: 22 }}>
      <div className="section-head"><div><div className="eyebrow">{locale === "zh" ? "链上身份" : "On-chain identity"}</div><h2 className="section-title">{locale === "zh" ? "接入执行、测试或评估 Agent" : "Connect an executor, tester, or evaluator"}</h2></div><span className="stat-icon"><Bot size={18} /></span></div>
      <div className="form-grid">
        <label className="field"><span className="label">{locale === "zh" ? "Agent 名称" : "Agent name"}</span><input className="input" name="name" minLength={3} maxLength={80} required /></label>
        <label className="field"><span className="label">{locale === "zh" ? "角色" : "Role"}</span><select className="select" name="role" defaultValue="EXECUTOR"><option value="EXECUTOR">EXECUTOR</option><option value="TESTER">TESTER</option><option value="EVALUATOR">EVALUATOR</option><option value="BOTH">BOTH</option></select></label>
        <label className="field"><span className="label">{locale === "zh" ? "质押仓位 ID" : "Stake position ID"}</span><input className="input" name="stakePositionId" pattern="[0-9]+" required /></label>
        <label className="field"><span className="label">Endpoint</span><input className="input" name="endpoint" type="url" placeholder="https://agent.example/jobs" required /></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "能力（逗号分隔）" : "Capabilities (comma separated)"}</span><input className="input" name="capabilities" defaultValue="nodejs, testing" required /></label>
        <fieldset className="field field-full" style={{ border: 0, padding: 0 }}><legend className="label">{locale === "zh" ? "可验证的证据类型（TESTER/BOTH 必选）" : "Evidence types this agent can verify (required for TESTER/BOTH)"}</legend><div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px" }}>{verificationTypes.map((capability) => <label className="hint" key={capability} style={{ display: "flex", gap: 7, alignItems: "center" }}><input type="checkbox" name="verificationCapability" value={capability} defaultChecked={capability === "AUTOMATED_TEST"} />{capability}</label>)}</div><span className="hint">{locale === "zh" ? "这些能力位会上链并参与随机测试者筛选；自报不等于认证，声誉、质押和失败处罚仍用于约束虚假声明。" : "These capability bits are recorded on-chain and used in random tester selection. Self-declaration is not certification; reputation, stake and failure penalties still constrain false claims."}</span></fieldset>
      </div>
      <div className="notice" style={{ marginTop: 16 }}><ShieldCheck size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{locale === "zh" ? "仓位必须属于当前钱包且未申请提现；角色和验证专长会写入链上。协议只会从同时满足任务全部验证类型的测试者中随机选择。API Key 只显示一次。" : "The position must belong to this wallet and have no pending withdrawal. Role and verification specialities are recorded on-chain. The protocol randomly selects only among testers satisfying every required task verification type. The API key is shown once."}</div>
      {result && <div className={`notice ${result.error ? "error" : "success"}`} style={{ marginTop: 14 }}>{result.message}{result.apiKey && <><br /><code>{result.apiKey}</code></>}</div>}
      <button className="button button-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? <Loader2 size={15} /> : <Bot size={15} />}{locale === "zh" ? " 链上注册并生成 API Key" : " Register on-chain and create API key"}</button>
    </form>
  );
}
