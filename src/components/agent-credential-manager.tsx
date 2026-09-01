"use client";

import { useState } from "react";
import { KeyRound, Loader2, Scale, ShieldOff } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { openRoleRehabilitationAppeal, setAgentActive } from "@/lib/chain-actions";
import { ActionNotice, type ActionResult } from "./action-notice";

interface ManagedAgent { id: string; name: string; owner: string; revokedAt?: string | null }

export function AgentCredentialManager({ locale, agents, sessionOwner }: { locale: Locale; agents: ManagedAgent[]; sessionOwner: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult & { apiKey?: string }>();
  const [revokedIds, setRevokedIds] = useState(() => new Set(agents.filter((agent) => agent.revokedAt).map((agent) => agent.id)));

  async function manage(formData: FormData) {
    const operation = String(formData.get("operation"));
    const agentId = String(formData.get("agentId"));
    if (operation === "revoke" && !window.confirm(locale === "zh" ? "立即撤销此 Agent 的现有 API Key？" : "Revoke this Agent's current API key now?")) return;
    setBusy(true); setResult(undefined);
    try {
      let chainHash: string | undefined;
      if (operation === "revoke" || revokedIds.has(agentId)) {
        chainHash = (await setAgentActive(operation !== "revoke", sessionOwner)).hash;
      }
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/credentials`, {
        method: operation === "revoke" ? "DELETE" : "POST",
        credentials: "same-origin",
      });
      const body = await response.json() as { apiKey?: string; revokedAt?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "AGENT_CREDENTIAL_UPDATE_FAILED");
      setRevokedIds((current) => {
        const next = new Set(current);
        if (operation === "revoke") next.add(agentId); else next.delete(agentId);
        return next;
      });
      setResult(operation === "revoke"
        ? { tone: "success", message: locale === "zh" ? `链上资格已停用，旧 API Key 验证材料已清除${chainHash ? `，交易 ${chainHash.slice(0, 10)}…` : ""}。` : `On-chain eligibility is disabled and the old API key verifier is erased${chainHash ? ` in ${chainHash.slice(0, 10)}…` : ""}.` }
        : { tone: "success", message: locale === "zh" ? `${chainHash ? `链上资格已恢复（${chainHash.slice(0, 10)}…）。` : ""}新 API Key 仅显示这一次，请立即保存到 Secret Manager。` : `${chainHash ? `On-chain eligibility restored (${chainHash.slice(0, 10)}…). ` : ""}This new API key is shown once. Store it in a secret manager now.`, apiKey: body.apiKey });
    } catch (error) {
      setResult({ tone: "error", message: error instanceof Error ? error.message : "AGENT_CREDENTIAL_UPDATE_FAILED" });
    } finally { setBusy(false); }
  }

  async function appeal(formData: FormData) {
    setBusy(true); setResult(undefined);
    try {
      const role = Number(formData.get("rehabilitationRole")) as 1 | 2 | 4;
      if (![1, 2, 4].includes(role)) throw new Error("INVALID_REHABILITATION_ROLE");
      const outcome = await openRoleRehabilitationAppeal(role, String(formData.get("rehabilitationEvidence") ?? ""), sessionOwner);
      setResult({ tone: "success", message: locale === "zh" ? `康复申诉已上链（${outcome.hash.slice(0, 10)}…），等待 2/3 仲裁者对相同裁决哈希投票。` : `Rehabilitation appeal confirmed (${outcome.hash.slice(0, 10)}…); it now requires two of three arbitrators to match the exact resolution hash.` });
    } catch (error) {
      setResult({ tone: "error", message: error instanceof Error ? error.message : "REHABILITATION_APPEAL_FAILED" });
    } finally { setBusy(false); }
  }

  if (agents.length === 0) return null;
  return (
    <div className="grid" style={{ marginBottom: 22 }}>
    <form className="card card-pad form-card" action={manage}>
      <div className="section-head"><div><div className="eyebrow">{locale === "zh" ? "凭据恢复" : "Credential recovery"}</div><h2 className="section-title">{locale === "zh" ? "轮换或撤销 Agent API Key" : "Rotate or revoke an Agent API key"}</h2></div><span className="stat-icon"><KeyRound size={18} /></span></div>
      <p className="hint">{locale === "zh" ? "只有绑定钱包可以操作。撤销先等待 AgentRegistry 链上停用确认，再清除旧 Key 验证材料；恢复先确认链上启用，再生成新 Key，避免链上仍选中已离线 Agent。" : "Only the bound wallet may act. Revocation confirms AgentRegistry deactivation before erasing the old key verifier; recovery confirms on-chain activation before issuing a new key, preventing selection of an offline Agent."}</p>
      <label className="field" style={{ marginTop: 14 }}><span className="label">Agent</span><select className="select" name="agentId" required>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name} · {agent.id} · {agent.owner.slice(0, 8)}…</option>)}</select></label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
        <button className="button button-primary" type="submit" name="operation" value="rotate" disabled={busy}>{busy ? <Loader2 size={15} /> : <KeyRound size={15} />}{locale === "zh" ? " 轮换并显示新 Key" : " Rotate and show new key"}</button>
        <button className="button button-danger" type="submit" name="operation" value="revoke" disabled={busy}><ShieldOff size={15} />{locale === "zh" ? " 撤销现有 Key" : " Revoke current key"}</button>
      </div>
    </form>
    <form className="card card-pad form-card" action={appeal}>
      <div className="section-head"><div><div className="eyebrow">ROLE REHABILITATION</div><h2 className="section-title">{locale === "zh" ? "公开链上康复申诉" : "Public on-chain rehabilitation appeal"}</h2></div><span className="stat-icon"><Scale size={18} /></span></div>
      <p className="hint">{locale === "zh" ? "仅限当前钱包所属 Agent 的冷却或封禁角色。系统会将 Court 可用质押补足至 500 AGT，再提交证据哈希；错误申诉依次罚没冻结快照的 5% / 15% / 30%。" : "Only a cooled-down or banned role owned by this wallet can appeal. The flow tops available Court stake up to 500 AGT before submitting the evidence hash. Rejected appeals slash 5% / 15% / 30% of the frozen snapshot."}</p>
      <div className="form-grid" style={{ marginTop: 14 }}>
        <label className="field"><span className="label">{locale === "zh" ? "申诉角色" : "Appeal role"}</span><select className="select" name="rehabilitationRole" defaultValue="1"><option value="1">EXECUTOR</option><option value="2">VALIDATOR</option><option value="4">EVALUATOR</option></select></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "康复证据定位或摘要" : "Rehabilitation evidence locator or summary"}</span><textarea className="textarea" name="rehabilitationEvidence" minLength={20} maxLength={2_000} required /></label>
      </div>
      <div className="notice" style={{ marginTop: 14 }}>{locale === "zh" ? "只有三名隔离仲裁者中两名对相同裁决哈希投相同方向才能恢复到 2500 分。三天无法定人数只解锁，不恢复角色。" : "Restoration to the 2500-bps floor requires two isolated arbitrators to vote the same direction with the exact same resolution hash. A three-day no-quorum expiry only unlocks stake."}</div>
      <button className="button button-primary" style={{ marginTop: 16 }} disabled={busy}>{busy ? <Loader2 size={15} /> : <Scale size={15} />}{locale === "zh" ? " 质押并提交申诉" : " Stake and submit appeal"}</button>
    </form>
    {result && <ActionNotice tone={result.tone}>{result.message}</ActionNotice>}
    {result?.apiKey && <div className="notice success"><code>{result.apiKey}</code></div>}
    </div>
  );
}
