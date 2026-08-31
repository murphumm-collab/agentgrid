"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { StakePosition } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";
import { encryptBrowserArtifact } from "@/lib/browser-artifact-crypto";
import { publishCommittedTask, waitForBrowserTransaction } from "@/lib/chain-actions";
import { parsePendingTaskEvaluation, type PendingTaskEvaluation } from "@/lib/pending-task-evaluation";
import { taskCategories, taskCategoryGroupLabel, taskCategoryGroups } from "@/components/task-category";
import { TaskSpecAssistant } from "@/components/task-spec-assistant";
import { assessTaskDefinition, taskDefinitionSchema, taskDefinitionVersion, verificationTypes } from "@/lib/task-definition";
import { requiredTesterCapabilityMask } from "@/lib/agent-roles";

function storageKey(publisher: string) {
  return `agentgrid:pending-evaluation:${publisher.toLowerCase()}`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 300);
  return "UNKNOWN_ERROR";
}

export function NewTaskForm({ positions, publisher, locale, production = false }: { positions: StakePosition[]; publisher: string; locale: Locale; production?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingEvaluation, setPendingEvaluation] = useState<PendingTaskEvaluation | null>(null);
  const available = positions.filter((position) => !position.activeTaskId && position.creditExpiresAt);

  useEffect(() => {
    if (!production || !publisher) return;
    let cancelled = false;
    const recover = async () => {
      try {
      const stored = window.localStorage.getItem(storageKey(publisher));
        if (stored) {
          setPendingEvaluation(parsePendingTaskEvaluation(JSON.parse(stored)));
          return;
        }
      } catch { window.localStorage.removeItem(storageKey(publisher)); }
      try {
        const response = await fetch("/api/chain/task-commitments", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "TASK_COMMITMENT_RECOVERY_FAILED");
        if (!cancelled && body.pending) persistPending(parsePendingTaskEvaluation(body.pending));
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    };
    void recover();
    return () => { cancelled = true; };
    // persistPending intentionally uses the current publisher and does not need to trigger recovery again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production, publisher]);

  function persistPending(value: PendingTaskEvaluation | null) {
    setPendingEvaluation(value);
    if (!publisher) return;
    try {
      if (value) window.localStorage.setItem(storageKey(publisher), JSON.stringify(value));
      else window.localStorage.removeItem(storageKey(publisher));
    } catch { /* React state still prevents an in-session duplicate broadcast. */ }
  }

  async function sendEvaluationTransaction(pending: PendingTaskEvaluation) {
    setSubmitting(true);
    setError(null);
    let current = pending;
    try {
      if (!current.transactionHash && current.broadcastReady !== undefined) {
        const recoveryResponse = await fetch("/api/chain/task-commitments", { cache: "no-store" });
        const recoveryBody = await recoveryResponse.json();
        if (!recoveryResponse.ok) throw new Error(recoveryBody.error ?? "TASK_COMMITMENT_RECOVERY_FAILED");
        if (!recoveryBody.pending) throw new Error("TASK_COMMITMENT_NOT_FOUND");
        current = parsePendingTaskEvaluation(recoveryBody.pending);
        persistPending(current);
        if (!current.transactionHash && current.broadcastReady === false) {
          throw new Error(`${locale === "zh" ? "服务器正在核对链上是否已有交易，请在此时间后重试" : "The server is reconciling a possible chain transaction; retry after"}: ${current.retryAfter ?? "later"}`);
        }
      }
      if (current.transactionHash) {
        const bindResponse = await fetch(`/api/chain/task-commitments/${encodeURIComponent(current.commitmentId)}/transaction`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ publisher, transactionHash: current.transactionHash }),
        });
        const bound = await bindResponse.json();
        if (!bindResponse.ok) throw new Error(bound.error ?? "TASK_COMMITMENT_TRANSACTION_BIND_FAILED");
        await waitForBrowserTransaction(current.transactionHash);
      } else {
        await publishCommittedTask({
          positionId: BigInt(current.positionId), specHash: current.specHash,
          requestedReward: current.requestedReward, maxExecutors: current.maxExecutors,
          executionMode: current.executionMode, requiredTesterCapabilities: current.requiredTesterCapabilities,
        }, async (transactionHash) => {
          current = { ...current, transactionHash, broadcastReady: false };
          persistPending(current);
          const bindResponse = await fetch(`/api/chain/task-commitments/${encodeURIComponent(current.commitmentId)}/transaction`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ publisher, transactionHash }),
          });
          const bound = await bindResponse.json();
          if (!bindResponse.ok) throw new Error(bound.error ?? "TASK_COMMITMENT_TRANSACTION_BIND_FAILED");
        });
      }
      persistPending(null);
      setSubmitted(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof Error && caught.message === "TRANSACTION_REVERTED" && current.transactionHash) {
        try {
          const clearResponse = await fetch(`/api/chain/task-commitments/${encodeURIComponent(current.commitmentId)}/transaction`, {
            method: "DELETE", headers: { "content-type": "application/json" },
            body: JSON.stringify({ publisher, transactionHash: current.transactionHash }),
          });
          const cleared = await clearResponse.json();
          if (!clearResponse.ok) throw new Error(cleared.error ?? "REVERTED_TRANSACTION_CLEAR_FAILED");
          persistPending({ ...current, transactionHash: undefined, broadcastReady: true });
          setError(locale === "zh" ? "链上交易已回滚，服务器已验证；你可以安全重试。" : "The transaction reverted and was verified by the server; it is safe to retry.");
        } catch (clearError) {
          setError(`${locale === "zh" ? "交易回滚，但服务器尚未确认；已保留交易哈希以阻止重复发布" : "The transaction reverted but the server has not verified it; the hash is retained to prevent duplicate publication"}: ${errorMessage(clearError)}`);
        }
      } else setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(formData: FormData) {
    setError(null);
    if (production && pendingEvaluation) {
      await sendEvaluationTransaction(pendingEvaluation);
      return;
    }
    setSubmitting(true);
    try {
    const lines = (name: string) => String(formData.get(name) ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
    const criteria = lines("criteria");
    const methods = lines("verificationMethods");
    const evidence = lines("evidenceRequirements");
    const passConditions = lines("passConditions");
    const criterionVerificationTypes = lines("verificationTypes");
    if ([methods, evidence, passConditions, criterionVerificationTypes].some((items) => items.length !== criteria.length)) throw new Error(locale === "zh" ? "每条完成条件都必须有同顺序的验证类型、验证方法、所需证据和通过阈值" : "Every completion criterion needs a matching verification type, method, evidence requirement and pass condition in the same order");
    if (criterionVerificationTypes.some((item) => !verificationTypes.includes(item as typeof verificationTypes[number]))) throw new Error(locale === "zh" ? "存在不支持的验证类型" : "Unsupported verification type");
    let aiReviews: unknown[] = [];
    try { aiReviews = JSON.parse(String(formData.get("aiReviewMetadata") ?? "[]")); } catch { throw new Error(locale === "zh" ? "AI 评审记录无效，请重新校验" : "Invalid AI review metadata; run the check again"); }
    const definitionReviewId = String(formData.get("definitionReviewId") ?? "").trim();
    if (production && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(definitionReviewId)) throw new Error(locale === "zh" ? "发布前必须完成 AI 定义校验并采用服务器签发的结果" : "Run and apply the server-issued AI definition review before publication");
    const completionDefinition = taskDefinitionSchema.parse({
      version: taskDefinitionVersion, targetUsers: formData.get("targetUsers"), deliverables: lines("deliverables"), constraints: lines("constraints"),
      outOfScope: lines("outOfScope"), assumptions: lines("assumptions"), aiReviews,
      acceptanceCriteria: criteria.map((description, index) => ({ id: `criterion-${index + 1}`, description, verificationMethod: methods[index], evidenceRequired: evidence[index], passCondition: passConditions[index], verificationType: criterionVerificationTypes[index], required: true })),
    });
    const readiness = assessTaskDefinition(completionDefinition);
    if (!readiness.ready) throw new Error(`${locale === "zh" ? "完成定义尚不可独立验收" : "Completion definition is not independently verifiable"}: ${[...readiness.blockers, ...readiness.warnings].join(", ")}`);
    let hiddenTestManifestId: string | undefined;
    let hiddenTestPlaintextSha256: string | undefined;
    if (production) {
      const hiddenFile = formData.get("hiddenTests");
      if (!(hiddenFile instanceof File) || !hiddenFile.size) { setError(locale === "zh" ? "必须上传隐藏测试 .tar.gz" : "A hidden-test .tar.gz archive is required"); return; }
      if (hiddenFile.size > 10 * 1024 * 1024) { setError(locale === "zh" ? "隐藏测试包不能超过 10MB" : "Hidden-test archive must be at most 10MB"); return; }
      const encrypted = await encryptBrowserArtifact(new Uint8Array(await hiddenFile.arrayBuffer()));
      const createdResponse = await fetch("/api/hidden-tests/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        publisher, sha256: encrypted.sha256, plaintextSha256: encrypted.plaintextSha256, sizeBytes: encrypted.ciphertext.byteLength,
        contentType: "application/gzip", encryptionAlgorithm: encrypted.encryptionAlgorithm, contentIv: encrypted.contentIv, encryptionKey: encrypted.encryptionKey,
      }) });
      const created = await createdResponse.json();
      if (!createdResponse.ok) { setError(created.error ?? "Hidden-test manifest creation failed"); return; }
      const uploadResponse = await fetch(`/api/hidden-tests/${created.id}/content`, { method: "PUT", headers: { "content-type": "application/octet-stream", "x-publisher": publisher }, body: encrypted.ciphertext as BodyInit });
      if (!uploadResponse.ok) { const failed = await uploadResponse.json(); setError(failed.error ?? "Hidden-test upload failed"); return; }
      const finalizeResponse = await fetch(`/api/hidden-tests/${created.id}/finalize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publisher }) });
      const finalized = await finalizeResponse.json();
      if (!finalizeResponse.ok) { setError(finalized.error ?? "Hidden-test finalization failed"); return; }
      hiddenTestManifestId = created.id;
      hiddenTestPlaintextSha256 = encrypted.plaintextSha256;
    }
    const payload = {
      publisher, stakePositionId: formData.get("stakePositionId"), title: formData.get("title"),
      description: formData.get("description"), category: formData.get("category"), executionMode: formData.get("executionMode"), maxExecutors: Number(formData.get("maxExecutors")),
      declaredDurationHours: Number(formData.get("declaredDurationHours")), criteria, completionDefinition, requestedReward: Number(formData.get("requestedReward") ?? 2500),
      ...(production ? { definitionReviewId, hiddenTestManifestId, hiddenTestPlaintextSha256 } : {}),
    };
    const response = await fetch(production ? "/api/chain/task-commitments" : "/api/tasks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? t(locale, "unablePublish")); return; }
    if (production) {
      const pending = parsePendingTaskEvaluation({
        commitmentId: body.id,
        positionId: String(payload.stakePositionId), specHash: body.specHash,
        requestedReward: String(payload.requestedReward), maxExecutors: payload.maxExecutors,
        executionMode: payload.executionMode === "COMPETITION" ? "COMPETITION" : "COLLABORATION",
        requiredTesterCapabilities: requiredTesterCapabilityMask(completionDefinition),
      });
      persistPending(pending);
      setSubmitting(false);
      await sendEvaluationTransaction(pending);
      return;
    }
    router.push(`/tasks/${body.id}`); router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form id="new-task-form" className="card card-pad form-card" action={submit}>
      {!available.length && <div className="notice error" style={{ marginBottom: 18 }}>{t(locale, "noCredit")}{production ? " · Waiting for confirmed chain index" : ""}</div>}
      {production && <div className="notice" style={{ marginBottom: 18 }}><ShieldCheck size={15} style={{ verticalAlign: "middle", marginRight: 8 }} /><strong>{t(locale, "evaluationGate")}</strong><div style={{ marginTop: 6 }}>{t(locale, "evaluationGateLead")}</div></div>}
      <fieldset className="form-grid form-fieldset" disabled={Boolean(pendingEvaluation || submitted || submitting)}>
        <label className="field field-full"><span className="label">{t(locale, "taskTitle")}</span><input className="input" name="title" required minLength={8} placeholder={locale === "zh" ? "构建一个交易异常检测服务" : "Build a transaction anomaly detection service"} /></label>
        <label className="field field-full"><span className="label">{t(locale, "businessOutcome")}</span><textarea className="textarea" name="description" required minLength={30} placeholder={t(locale, "businessPlaceholder")} /><span className="hint">{t(locale, "implementationHint")}</span></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "谁会使用或批准成果" : "Who will use or approve the result"}</span><input className="input" name="targetUsers" required minLength={12} placeholder={locale === "zh" ? "例如：每天处理退款的财务运营团队负责人" : "Example: the finance operations lead handling daily refunds"} /></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "必须交付什么（每行一项）" : "Required deliverables (one per line)"}</span><textarea className="textarea" name="deliverables" required placeholder={locale === "zh" ? "可运行服务及源码\n部署与回滚说明\n验收测试报告" : "Runnable service and source\nDeployment and rollback guide\nAcceptance test report"} /></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "强制约束（每行一项）" : "Mandatory constraints (one per line)"}</span><textarea className="textarea" name="constraints" required placeholder={locale === "zh" ? "不得访问生产密钥\n兼容 Node.js 22\n测试期间禁止外网" : "No access to production keys\nCompatible with Node.js 22\nNo network during tests"} /></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "明确不包含什么（每行一项）" : "Explicitly out of scope (one per line)"}</span><textarea className="textarea" name="outOfScope" required placeholder={locale === "zh" ? "主网部署\n发布后新增需求" : "Mainnet deployment\nRequirements added after publication"} /></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "前提假设（可选，每行一项）" : "Assumptions (optional, one per line)"}</span><textarea className="textarea" name="assumptions" /></label>
        <label className="field"><span className="label">{t(locale, "stakePosition")}</span><select className="select" name="stakePositionId" required defaultValue=""><option value="" disabled>{t(locale, "selectPosition")}</option>{available.map((position) => <option key={position.id} value={position.id}>{position.amount.toLocaleString()} AGT · {t(locale, "creditActive")}</option>)}</select></label>
        <label className="field"><span className="label">{t(locale, "category")}</span><select className="select" name="category" defaultValue="Development">{taskCategoryGroups.map((group) => <optgroup label={taskCategoryGroupLabel(group.id, locale)} key={group.id}>{taskCategories.filter((category) => category.group === group.id).map((category) => <option value={category.id} key={category.id}>{category[locale]}</option>)}</optgroup>)}</select><span className="hint">{locale === "zh" ? "18 个细分分类，评估 Agent 会在发布前复核分类是否准确。" : "18 detailed categories; evaluator Agents verify the classification before publication."}</span></label>
        <label className="field"><span className="label">{locale === "zh" ? "执行模式" : "Execution mode"}</span><select className="select" name="executionMode" defaultValue="COLLABORATION"><option value="COLLABORATION">{locale === "zh" ? "协作：多 Agent 分工并组装" : "Collaboration: divide and assemble"}</option><option value="COMPETITION">{locale === "zh" ? "竞争：独立候选统一测试" : "Competition: isolated candidates"}</option></select><span className="hint">{locale === "zh" ? "竞争模式中候选互不可见，测试 Agent 在相同隐藏测试下选出最终成果。" : "Competition keeps candidates mutually isolated; the tester selects the final artifact under identical hidden tests."}</span></label>
        <label className="field"><span className="label">{t(locale, "maxExecutors")}</span><input className="input" name="maxExecutors" type="number" min="1" max="32" defaultValue="2" /></label>
        <label className="field"><span className="label">{t(locale, "declaredDuration")}</span><select className="select" name="declaredDurationHours" defaultValue="48"><option value="8">8 {t(locale, "hours")}</option><option value="24">24 {t(locale, "hours")}</option><option value="48">48 {t(locale, "hours")}</option><option value="168">{locale === "zh" ? "7 天" : "7 days"}</option></select></label>
        {production && <label className="field"><span className="label">{locale === "zh" ? "申请奖励 (tAGT)" : "Requested reward (tAGT)"}</span><input className="input" name="requestedReward" type="number" min="1" defaultValue="2500" required /></label>}
        {production && <label className="field field-full"><span className="label">{locale === "zh" ? "隐藏测试包 (.tar.gz)" : "Hidden tests (.tar.gz)"}</span><input className="input" name="hiddenTests" type="file" accept=".gz,application/gzip" required /><span className="hint">{locale === "zh" ? "发布前在浏览器本地加密；执行 Agent 不可访问。测试文件需以 .test.js 或 .test.mjs 结尾，从 test/hidden 运行。" : "Encrypted locally before publication and never exposed to executors. Include .test.js or .test.mjs files, run from test/hidden."}</span></label>}
        <label className="field field-full"><span className="label">{t(locale, "acceptanceCriteria")}</span><textarea className="textarea" name="criteria" required defaultValue={locale === "zh" ? "应用可以无错误构建\n公开测试和隐藏测试全部通过\n关键分支覆盖率不低于 95%" : "Application builds without errors\nPublic and hidden tests pass\nCritical branch coverage is at least 95%"} /><span className="hint">{t(locale, "criteriaHint")}</span></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "验证类型（逐行对应）" : "Verification types (line-aligned)"}</span><textarea className="textarea" name="verificationTypes" required defaultValue={"AUTOMATED_TEST\nAUTOMATED_TEST\nAUTOMATED_TEST"} /><span className="hint">{locale === "zh" ? "可选：AUTOMATED_TEST、ARTIFACT_INSPECTION、DATA_VALIDATION、EXTERNAL_OBSERVATION、HUMAN_REVIEW。通用 CI Agent 只能接 AUTOMATED_TEST。" : "Allowed: AUTOMATED_TEST, ARTIFACT_INSPECTION, DATA_VALIDATION, EXTERNAL_OBSERVATION, HUMAN_REVIEW. The generic CI Agent can only accept AUTOMATED_TEST."}</span></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "验证方法（与完成条件逐行对应）" : "Verification methods (line-aligned with criteria)"}</span><textarea className="textarea" name="verificationMethods" required defaultValue={locale === "zh" ? "在隔离环境执行生产构建命令\n由随机测试 Agent 运行公开及加密隐藏测试\n生成覆盖率报告并检查关键分支" : "Run the production build command in an isolated environment\nRandom tester Agent runs public and encrypted hidden tests\nGenerate coverage report and inspect critical branches"} /></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "必须提交的证据（逐行对应）" : "Required evidence (line-aligned)"}</span><textarea className="textarea" name="evidenceRequirements" required defaultValue={locale === "zh" ? "签名构建日志与成果哈希\n测试 Agent 签名的测试结果与隐藏测试清单哈希\n签名覆盖率报告" : "Signed build log and artifact hash\nTester-signed results and hidden-test manifest hash\nSigned coverage report"} /></label>
        <label className="field field-full"><span className="label">{locale === "zh" ? "二元或数字通过条件（逐行对应）" : "Binary or numeric pass conditions (line-aligned)"}</span><textarea className="textarea" name="passConditions" required defaultValue={locale === "zh" ? "构建命令退出码必须等于 0\n所有公开测试和隐藏测试必须通过，失败数等于 0\n关键分支覆盖率必须不低于 95%" : "Build command exit code must equal 0\nAll public and hidden tests must pass with zero failures\nCritical branch coverage must be at least 95%"} /></label>
        <input type="hidden" name="aiReviewMetadata" defaultValue="[]" />
        <input type="hidden" name="definitionReviewId" defaultValue="" />
        <div className="field field-full"><TaskSpecAssistant formId="new-task-form" publisher={publisher} locale={locale} production={production} /></div>
      </fieldset>
      <div className="notice" style={{ marginTop: 20 }}><ShieldCheck size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />{t(locale, "publishLockNotice")}</div>
      {production && <div className="notice" style={{ marginTop: 12 }}>{locale === "zh" ? "提交申请会从质押中扣除 3 AGT 不可退评估费，并分给实际提交报告的评估 Agent。只有至少 2/3 通过并公开任务时，才另扣发布费：有效奖励额的 2%，最低 10 AGT，最高为仓位的 10%。" : "Submitting charges a non-refundable 3 AGT evaluation fee from the stake and pays evaluators who report. A separate publication fee is charged only after at least 2 of 3 approve: 2% of effective reward, minimum 10 AGT, capped at 10% of the position."}</div>}
      {error && <div className="notice error" style={{ marginTop: 14 }}>{error}</div>}
      {pendingEvaluation && !submitted && <div className="notice" style={{ marginTop: 14 }}>{locale === "zh" ? `加密测试与任务承诺已保存。${pendingEvaluation.transactionHash ? "交易已广播，将继续等待 5 个确认；不会重复发布或重复扣费。" : "钱包交易尚未广播，点击下方按钮可安全重试。"}` : `The encrypted tests and task commitment are saved. ${pendingEvaluation.transactionHash ? "The transaction was broadcast and will resume waiting for 5 confirmations without republishing or charging twice." : "No transaction was broadcast; use the button below to retry safely."}`}</div>}
      {submitted && <div className="notice success" style={{ marginTop: 14 }}>{t(locale, "evaluationSubmitted")}</div>}
      <div className="form-actions"><button type="button" className="button button-secondary" disabled={submitting} onClick={() => router.back()}>{t(locale, "cancel")}</button><button className="button button-primary" disabled={!available.length || submitted || submitting}>{submitting ? (locale === "zh" ? "等待确认…" : "Waiting for confirmation…") : pendingEvaluation ? (locale === "zh" ? "继续链上评估申请" : "Resume evaluation transaction") : production ? t(locale, "requestEvaluation") : t(locale, "publishTask")} <ArrowRight size={15} /></button></div>
    </form>
  );
}
