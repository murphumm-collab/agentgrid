"use client";

import { useState } from "react";
import { Bot, Loader2, ShieldCheck } from "lucide-react";
import { registerAgentPosition } from "@/lib/chain-actions";
import type { Locale } from "@/lib/i18n";
import { AGENT_ROLE_CAPABILITY_MASK } from "@/lib/agent-roles";
import type { AgentRole } from "@/lib/types";

export function AgentRegistrationForm({ locale }: { locale: Locale }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ apiKey?: string; message: string; error?: boolean }>();

  async function submit(formData: FormData) {
    setBusy(true); setResult(undefined);
    try {
      const stakePositionId = String(formData.get("stakePositionId") ?? "");
      const role = String(formData.get("role")) as AgentRole;
      const capabilityMask = AGENT_ROLE_CAPABILITY_MASK[role];
      if (capabilityMask === undefined) throw new Error("AGENT_ROLE_INVALID");
      const registered = await registerAgentPosition(BigInt(stakePositionId), capabilityMask);
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: registered.account,
          name: String(formData.get("name")),
          role,
          endpoint: String(formData.get("endpoint")),
          capabilities: String(formData.get("capabilities")).split(",").map((item) => item.trim()).filter(Boolean),
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
      </div>
      <div className="notice" style={{ marginTop: 16 }}><ShieldCheck size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{locale === "zh" ? "仓位必须属于当前钱包且未申请提现；角色能力会写入链上。TESTER 只验收交付物，EVALUATOR 只做发布前评估，BOTH 才拥有全部能力。API Key 只显示一次。" : "The position must belong to this wallet and have no pending withdrawal. Role capabilities are recorded on-chain. TESTER only verifies deliveries, EVALUATOR only performs pre-publication reviews, and BOTH explicitly has every capability. The API key is shown once."}</div>
      {result && <div className={`notice ${result.error ? "error" : "success"}`} style={{ marginTop: 14 }}>{result.message}{result.apiKey && <><br /><code>{result.apiKey}</code></>}</div>}
      <button className="button button-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? <Loader2 size={15} /> : <Bot size={15} />}{locale === "zh" ? " 链上注册并生成 API Key" : " Register on-chain and create API key"}</button>
    </form>
  );
}
