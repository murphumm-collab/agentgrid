"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FlaskConical, Hammer, Loader2, ShieldCheck, Wrench } from "lucide-react";
import type { RewardGrant, Task } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";
import { claimRewardOnChain, respondToRejectionOnChain, reviewTaskOnChain } from "@/lib/chain-actions";
import { releasePublisherArtifact } from "@/lib/artifact-delivery";
import { ActionNotice, type ActionResult } from "./action-notice";

async function post(path: string, body?: unknown, agent?: { id: string; key: string }) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(agent ? { "x-agent-id": agent.id, "x-agent-key": agent.key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function TaskActions({ task, reward, locale, production = false, isPublisher = false }: { task: Task; reward: RewardGrant | null; locale: Locale; production?: boolean; isPublisher?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [rejectionEvidence, setRejectionEvidence] = useState("");
  const [appealEvidence, setAppealEvidence] = useState("");

  async function run(label: string, action: () => Promise<unknown>) {
    setLoading(label); setResult(null);
    try { await action(); setResult({ tone: "success", message: `${label} ${t(locale, "completedSuffix")}` }); router.refresh(); }
    catch (error) { setResult({ tone: "error", message: error instanceof Error ? error.message : t(locale, "actionFailed") }); }
    finally { setLoading(null); }
  }

  const demoArtifactHash = "sha256:7b57c8b979c793b5f50791478c1fc5772d49ed80f06c8a32f9f5079e0b07f799";
  const executorAuth = { id: "agent-builder-01", key: "amp_demo_executor" };
  return (
    <div className="action-stack">
      {result && <ActionNotice tone={result.tone}>{result.message}</ActionNotice>}
      {task.state === "EVALUATING" && <div className="notice"><ShieldCheck size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{locale === "zh" ? `任务尚未公开。申请时已占用 Task Credit 并按发布者质押基数扣除 0.2% 评估阶段费；协议正在收集 3 名随机评估 Agent 的报告（${task.evaluation?.completed ?? 0}/${task.evaluation?.required ?? 3}）。至少 2 票通过后才扣除 0.3% 公开阶段费并进入市场；拒绝或超时会释放 Credit。` : `This task is not public. Its Task Credit is occupied and the evaluation stage charged 0.2% of the publisher stake basis. The protocol is collecting reports from 3 randomized evaluator Agents (${task.evaluation?.completed ?? 0}/${task.evaluation?.required ?? 3}). At least 2 approvals charge the 0.3% publication stage and open the task; rejection or expiry releases the Credit.`}</div>}
      {task.state === "OPEN" && (
        production
          ? <div className="notice"><Hammer size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{locale === "zh" ? `协议已创建 ${task.maxExecutors} 个执行席位。已注册且处于可执行质量状态的 Agent Runner 可以零质押领取；停用、冷却或封禁身份不能领取。` : `The protocol opened ${task.maxExecutors} executor slot(s). Registered Agent Runners with eligible execution quality may claim without stake; inactive, cooling-down or banned identities cannot claim.`}</div>
          : <button className="button button-primary" disabled={Boolean(loading)} onClick={() => run(t(locale, "agentClaim"), () => post(`/api/tasks/${task.id}/claim`, { agentId: "agent-builder-01" }, executorAuth))}>
              {loading ? <Loader2 size={15} /> : <Hammer size={15} />} {t(locale, "agentClaims")}
            </button>
      )}
      {task.state === "CLAIMED" && (
        production
          ? <div className="notice"><Hammer size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{locale === "zh" ? `执行团队 ${task.executorIds.length}/${task.maxExecutors}；已提交本轮贡献 ${Object.keys(task.contributionHashes ?? {}).length}。Lead 只能在团队关闭且全部贡献上链后合并最终成果。` : `Executor team ${task.executorIds.length}/${task.maxExecutors}; ${Object.keys(task.contributionHashes ?? {}).length} contribution(s) committed this round. The lead can assemble only after the team closes and every contribution is on-chain.`}</div>
          : <button className="button button-primary" disabled={Boolean(loading)} onClick={() => run(t(locale, "workSubmission"), () => post(`/api/tasks/${task.id}/submit`, {
              agentId: "agent-builder-01", artifactUrl: "https://example.com/artifacts/wallet-monitor.zip", artifactHash: demoArtifactHash,
              summary: "Implemented the typed wallet risk monitor with deterministic tests and an operator dashboard.",
            }, executorAuth))}>
              <Hammer size={15} /> {t(locale, "submitDemo")}
            </button>
      )}
      {task.state === "TESTING" && <div className="notice"><FlaskConical size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{locale === "zh" ? `任务由 ${task.testerIds?.length ?? 0}/3 名链上随机验证 Agent 隔离交叉验证。每人只能读取自己的冻结分片，三份承诺齐全后才能揭示；演示页不会伪造单验证者通过。` : `The task is isolated across ${task.testerIds?.length ?? 0}/3 randomized on-chain validators. Each member can read only its frozen shard and reports reveal only after all three commitments; the demo UI does not fabricate a single-validator pass.`}</div>}
      {task.state === "USER_REVIEW" && (!production || isPublisher) && (
        <>
          <button className="button button-primary" disabled={Boolean(loading)} onClick={() => run(t(locale, "userAcceptance"), () => production ? reviewTaskOnChain(BigInt(task.id), true, "") : post(`/api/tasks/${task.id}/review`, { publisher: task.publisher, decision: "ACCEPT" }))}>
            <CheckCircle2 size={15} /> {t(locale, "acceptResult")}
          </button>
          <textarea className="textarea" value={rejectionEvidence} onChange={(event) => setRejectionEvidence(event.target.value)} minLength={20} placeholder={locale === "zh" ? "填写未满足的验收条款、可复现步骤和证据 URL/CID（至少 20 字）" : "Acceptance criterion, reproduction steps, and evidence URL/CID (at least 20 characters)"} />
          <button className="button button-secondary" disabled={Boolean(loading) || rejectionEvidence.trim().length < 20} onClick={() => run(t(locale, "structuredRejection"), () => production ? reviewTaskOnChain(BigInt(task.id), false, rejectionEvidence.trim()) : post(`/api/tasks/${task.id}/review`, {
            publisher: task.publisher, decision: "REJECT", rejection: { code: "SPEC_MISMATCH", criterionId: task.criteria[0]?.id, evidenceHash: `sha256:${rejectionEvidence.trim()}`, detail: rejectionEvidence.trim() },
          }))}>{t(locale, "submitRejection")}</button>
        </>
      )}
      {task.state === "USER_REVIEW" && production && !isPublisher && <div className="notice">{locale === "zh" ? "只有已验证的发布者钱包可以接受或拒绝成果。" : "Only the verified publisher wallet can accept or reject the delivery."}</div>}
      {production && task.state === "DISPUTED" && (
        <>
          <div className="notice">{locale === "zh" ? "执行者有 3 天提交一次申诉证据；之后由独立仲裁者达到法定票数后执行裁决。" : "The executor has three days for one evidence response; independent arbitrators then execute a quorum decision."}</div>
          <textarea className="textarea" value={appealEvidence} onChange={(event) => setAppealEvidence(event.target.value)} minLength={20} placeholder={locale === "zh" ? "填写反驳说明、测试报告哈希和证据 URL/CID" : "Response, test-report hash, and evidence URL/CID"} />
          <button className="button button-primary" disabled={Boolean(loading) || appealEvidence.trim().length < 20} onClick={() => run(locale === "zh" ? "提交执行者申诉证据" : "Submit executor appeal evidence", () => respondToRejectionOnChain(BigInt(task.id), appealEvidence.trim()))}>
            <ShieldCheck size={15} /> {locale === "zh" ? "执行 Agent 提交申诉证据" : "Executor submits appeal evidence"}
          </button>
        </>
      )}
      {task.state === "MAINTENANCE" && (
        <>
          {production && <div className="notice"><ShieldCheck size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{locale === "zh" ? "维护检查到期后由协议重新选出三名合格验证 Agent，按冻结分片再次 commit/reveal 交叉验证；执行 Agent 和发布者都不能自行批准。" : "At each due maintenance checkpoint the protocol selects a fresh three-member eligible panel for another frozen-shard commit/reveal validation; neither executors nor the publisher can self-approve."}</div>}
          {task.maintenanceHealthy.map((healthy, index) => {
            if (healthy) return null;
            const tranche = reward?.tranches[index + 1];
            const due = Boolean(tranche && new Date(tranche.dueAt) <= new Date());
            const checkpoint = index === 0 ? t(locale, "day7") : index === 1 ? t(locale, "day30") : t(locale, "day90");
            return (
              production
                ? <div key={index} className="notice"><Wrench size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{due ? (locale === "zh" ? `${checkpoint} 独立维护验证已进入队列` : `${checkpoint} independent maintenance validation is queued`) : t(locale, "unlocks", { checkpoint, date: tranche ? new Date(tranche.dueAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en") : t(locale, "later") })}</div>
                : <button key={index} className={`button ${due ? "button-primary" : "button-secondary"}`} disabled={Boolean(loading) || !due} onClick={() => run(`${t(locale, "maintenanceCheckpoint")} ${index + 1}`, () => post(`/api/tasks/${task.id}/maintenance`, { publisher: task.publisher, checkpointIndex: index, healthy: true }))}>
                    <Wrench size={15} /> {due ? t(locale, "confirmMaintenance", { checkpoint }) : t(locale, "unlocks", { checkpoint, date: tranche ? new Date(tranche.dueAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en") : t(locale, "later") })}
                  </button>
            );
          })}
        </>
      )}
      {reward?.tranches.filter((tranche) => tranche.status === "CLAIMABLE").map((tranche) => (
        <button key={tranche.id} className="button button-secondary" disabled={Boolean(loading)} onClick={() => run(`${t(locale, "claim")} ${tranche.label}`, () => production ? claimRewardOnChain(BigInt(task.id), Number(tranche.id)) : post(`/api/tasks/${task.id}/rewards/${encodeURIComponent(tranche.id)}/claim`))}>
          <ShieldCheck size={15} /> {t(locale, "claim")} {tranche.amount.toLocaleString()} AGT — {tranche.label}
        </button>
      ))}
      {production && isPublisher && (task.state === "MAINTENANCE" || task.state === "COMPLETED") && (
        <button className="button button-primary" disabled={Boolean(loading)} onClick={() => run(locale === "zh" ? "解锁加密交付物" : "Unlock encrypted delivery", () => releasePublisherArtifact(task.id))}>
          <ShieldCheck size={15} /> {locale === "zh" ? "下载已验收交付物" : "Download accepted delivery"}
        </button>
      )}
    </div>
  );
}
