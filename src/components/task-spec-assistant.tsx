"use client";

import { useState } from "react";
import { Bot, Check, ShieldAlert, Sparkles } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { TaskClarificationReview, TaskDefinitionAssessment } from "@/lib/task-definition";

type AssistantResponse = {
  aiAvailable: boolean;
  reviews: Array<{ role: string; provider: string; model: string; reportHash: string; review: TaskClarificationReview }>;
  recommendation: {
    targetUsers: string; deliverables: string[]; constraints: string[]; outOfScope: string[]; assumptions: string[];
    acceptanceCriteria: Array<{ description: string; verificationMethod: string; evidenceRequired: string; passCondition: string; verificationType: string }>;
    aiReviews: Array<{ role: string; provider: string; model: string; reportHash: string }>;
  };
  assessment: TaskDefinitionAssessment;
  definitionHash: string;
  reviewedTaskHash: string;
  definitionReview: { id: string; expiresAt: string } | null;
};

function lines(value: FormDataEntryValue | null) {
  return String(value ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function field(form: HTMLFormElement, name: string) {
  return form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
}

function setField(form: HTMLFormElement, name: string, value: string) {
  const control = field(form, name);
  if (!control) return;
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

export function TaskSpecAssistant({ formId, publisher, locale, production = false }: { formId: string; publisher: string; locale: Locale; production?: boolean }) {
  const [result, setResult] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function review() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    setLoading(true); setError(null);
    setField(form, "definitionReviewId", "");
    try {
      const data = new FormData(form);
      const criteria = lines(data.get("criteria"));
      const methods = lines(data.get("verificationMethods"));
      const evidence = lines(data.get("evidenceRequirements"));
      const passConditions = lines(data.get("passConditions"));
      const verificationTypes = lines(data.get("verificationTypes"));
      const response = await fetch("/api/task-spec-assistant", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publisher, title: data.get("title"), businessOutcome: data.get("description"), category: data.get("category"),
          targetUsers: String(data.get("targetUsers") ?? ""), deliverables: lines(data.get("deliverables")), constraints: lines(data.get("constraints")),
          outOfScope: lines(data.get("outOfScope")), assumptions: lines(data.get("assumptions")),
          criteria: criteria.map((description, index) => ({ description, verificationMethod: methods[index] ?? "", evidenceRequired: evidence[index] ?? "", passCondition: passConditions[index] ?? "", verificationType: verificationTypes[index] ?? "AUTOMATED_TEST", required: true })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "SPEC_ASSISTANT_FAILED");
      setResult(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "SPEC_ASSISTANT_FAILED"); }
    finally { setLoading(false); }
  }

  function apply() {
    if (!result) return;
    const blocking = result.reviews.flatMap((item) => item.review.clarifyingQuestions).some((item) => item.blocking);
    if (blocking) { setError(locale === "zh" ? "请先回答所有阻塞问题，再重新校验；系统不会替发布者猜测业务事实。" : "Answer every blocking question and re-run the check; the system will not guess business facts."); return; }
    if (!result.assessment.ready || (production && !result.definitionReview)) { setError(locale === "zh" ? "当前定义未通过服务器校验，不能生成发布凭证。" : "The definition did not pass the server gate, so no publication credential was issued."); return; }
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const recommendation = result.recommendation;
    setField(form, "targetUsers", recommendation.targetUsers);
    setField(form, "deliverables", recommendation.deliverables.join("\n"));
    setField(form, "constraints", recommendation.constraints.join("\n"));
    setField(form, "outOfScope", recommendation.outOfScope.join("\n"));
    setField(form, "assumptions", recommendation.assumptions.join("\n"));
    setField(form, "criteria", recommendation.acceptanceCriteria.map((item) => item.description).join("\n"));
    setField(form, "verificationMethods", recommendation.acceptanceCriteria.map((item) => item.verificationMethod).join("\n"));
    setField(form, "evidenceRequirements", recommendation.acceptanceCriteria.map((item) => item.evidenceRequired).join("\n"));
    setField(form, "passConditions", recommendation.acceptanceCriteria.map((item) => item.passCondition).join("\n"));
    setField(form, "verificationTypes", recommendation.acceptanceCriteria.map((item) => item.verificationType).join("\n"));
    setField(form, "aiReviewMetadata", JSON.stringify(recommendation.aiReviews));
    setField(form, "definitionReviewId", result.definitionReview?.id ?? "");
    setError(null);
  }

  const questions = result?.reviews.flatMap((item) => item.review.clarifyingQuestions).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index) ?? [];
  const risks = result?.reviews.flatMap((item) => item.review.risks).filter((item, index, all) => all.indexOf(item) === index) ?? [];
  const blocking = questions.some((item) => item.blocking);
  return <section className="spec-assistant">
    <div className="section-head"><div><div className="eyebrow">AI DEFINITION GATE</div><h3 className="section-title">{locale === "zh" ? "发布前需求澄清" : "Pre-publish requirement clarification"}</h3></div><button type="button" className="button button-secondary" onClick={review} disabled={loading}><Sparkles size={15} />{loading ? (locale === "zh" ? "正在交叉校验…" : "Cross-checking…") : (locale === "zh" ? "让 AI 校验完成定义" : "Ask AI to validate completion")}</button></div>
    <p className="hint">{locale === "zh" ? `需求编写 AI 负责拆解；验证批评 AI 专门找模糊条件、不可复现证据和容易刷的指标。${production ? "生产发布必须同时取得两个外部 AI 角色的有效报告；规则引擎只能提示，不能签发发布凭证。" : "真实 AI 未配置时会使用确定性规则引擎。"}` : `A requirements writer structures the task; a validation critic looks for ambiguity, irreproducible evidence and gameable metrics. ${production ? "Production publication requires valid reports from both external AI roles; the rule engine can advise but cannot issue a publication credential." : "A deterministic rule engine is used when external AI is not configured."}`}</p>
    {result && <>
      <div className={`notice ${blocking || !result.assessment.ready ? "error" : "success"}`} style={{ marginTop: 14 }}>{blocking || !result.assessment.ready ? <ShieldAlert size={15} /> : <Check size={15} />} <strong>{locale === "zh" ? `就绪度 ${result.assessment.score}/100` : `Readiness ${result.assessment.score}/100`}</strong> · {result.aiAvailable ? (locale === "zh" ? "多模型 AI 已参与" : "Multi-model AI participated") : (locale === "zh" ? "规则引擎校验" : "Rule-engine validation")}</div>
      {questions.length > 0 && <div className="spec-review-list"><strong>{locale === "zh" ? "发布者必须回答" : "Publisher must answer"}</strong>{questions.map((item) => <div className="spec-review-item" key={item.id}><Bot size={14} /><span>{item.question}<small>{item.reason}</small></span></div>)}</div>}
      {risks.length > 0 && <details className="spec-review-details"><summary>{locale === "zh" ? `查看 ${risks.length} 项验收风险` : `View ${risks.length} validation risks`}</summary><ul>{risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></details>}
      <div className="hint" style={{ marginTop: 10 }}>{result.reviews.map((item) => `${item.role}: ${item.provider}/${item.model}`).join(" · ")}</div>
      <button type="button" className="button button-primary" style={{ marginTop: 12 }} onClick={apply} disabled={blocking || !result.assessment.ready || (production && !result.definitionReview)}>{locale === "zh" ? "采用 AI 优化后的验收规则" : "Apply AI-refined completion rules"}</button>
      {production && result.definitionReview && <div className="hint" style={{ marginTop: 10 }}>{locale === "zh" ? `服务器发布凭证有效至 ${new Date(result.definitionReview.expiresAt).toLocaleString("zh-CN")}；修改任务定义后必须重新校验。` : `Server publication credential expires ${new Date(result.definitionReview.expiresAt).toLocaleString("en-US")}; any definition change requires another review.`}</div>}
    </>}
    {error && <div className="notice error" style={{ marginTop: 12 }}>{error}</div>}
  </section>;
}
