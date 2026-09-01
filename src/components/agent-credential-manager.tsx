"use client";

import { useState } from "react";
import { KeyRound, Loader2, ShieldOff } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { setAgentActive } from "@/lib/chain-actions";
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

  if (agents.length === 0) return null;
  return (
    <form className="card card-pad form-card" action={manage} style={{ marginBottom: 22 }}>
      <div className="section-head"><div><div className="eyebrow">{locale === "zh" ? "凭据恢复" : "Credential recovery"}</div><h2 className="section-title">{locale === "zh" ? "轮换或撤销 Agent API Key" : "Rotate or revoke an Agent API key"}</h2></div><span className="stat-icon"><KeyRound size={18} /></span></div>
      <p className="hint">{locale === "zh" ? "只有绑定钱包可以操作。撤销先等待 AgentRegistry 链上停用确认，再清除旧 Key 验证材料；恢复先确认链上启用，再生成新 Key，避免链上仍选中已离线 Agent。" : "Only the bound wallet may act. Revocation confirms AgentRegistry deactivation before erasing the old key verifier; recovery confirms on-chain activation before issuing a new key, preventing selection of an offline Agent."}</p>
      <label className="field" style={{ marginTop: 14 }}><span className="label">Agent</span><select className="select" name="agentId" required>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name} · {agent.id} · {agent.owner.slice(0, 8)}…</option>)}</select></label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
        <button className="button button-primary" type="submit" name="operation" value="rotate" disabled={busy}>{busy ? <Loader2 size={15} /> : <KeyRound size={15} />}{locale === "zh" ? " 轮换并显示新 Key" : " Rotate and show new key"}</button>
        <button className="button button-danger" type="submit" name="operation" value="revoke" disabled={busy}><ShieldOff size={15} />{locale === "zh" ? " 撤销现有 Key" : " Revoke current key"}</button>
      </div>
      {result && <ActionNotice tone={result.tone} style={{ marginTop: 14 }}>{result.message}</ActionNotice>}
      {result?.apiKey && <div className="notice success" style={{ marginTop: 10 }}><code>{result.apiKey}</code></div>}
    </form>
  );
}
