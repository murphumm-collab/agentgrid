"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import type { NotificationRow } from "@/lib/store-postgres";
import type { Locale } from "@/lib/i18n";

const labels: Record<string, { en: string; zh: string }> = {
  TaskEvaluationRequested: { en: "Pre-publication evaluation requested", zh: "已申请发布前评估" },
  TaskEvaluationFeeCharged: { en: "3 AGT evaluation fee charged", zh: "已扣除 3 AGT 评估费" },
  EvaluationFeePaid: { en: "Evaluation fee reward paid", zh: "评估 Agent 已收到评估奖励" },
  TaskEvaluatorsAssigned: { en: "Random evaluator panel assigned", zh: "已随机分配评估 Agent 小组" },
  TaskEvaluationSubmitted: { en: "Evaluator report submitted", zh: "评估 Agent 已提交报告" },
  TaskEvaluationFinalized: { en: "Pre-publication evaluation finalized", zh: "发布前评估已完成" },
  TaskEvaluationExpired: { en: "Evaluation expired · Task Credit released", zh: "评估已超时 · Task Credit 已释放" },
  TaskCreated: { en: "Task publication confirmed", zh: "任务发布已确认" }, TaskClaimed: { en: "Executor claimed task", zh: "执行 Agent 已领取任务" },
  TaskExecutionModeSet: { en: "Execution mode committed on-chain", zh: "执行模式已在链上确认" },
  TaskPublicationFeeCharged: { en: "Approved task published · fee charged from stake", zh: "评估通过并发布 · 发布费已从质押中扣除" },
  ExecutorEvicted: { en: "Inactive executor replaced", zh: "失联执行 Agent 已被替换" },
  CompetitionReady: { en: "Isolated candidates ready for equal testing", zh: "隔离候选已就绪，开始统一测试" },
  WorkSubmitted: { en: "Encrypted delivery submitted", zh: "加密交付物已提交" }, TesterAssigned: { en: "Independent tester assigned", zh: "独立测试 Agent 已分配" },
  TestSubmitted: { en: "Independent test completed", zh: "独立测试已完成" }, UserReviewed: { en: "Publisher review recorded", zh: "发布者验收已记录" },
  CompetitionResultSubmitted: { en: "Competition winner selected by independent test", zh: "独立测试已选出竞争胜者" },
  RejectionResponded: { en: "Executor appeal evidence submitted", zh: "执行者申诉证据已提交" }, RejectionResolved: { en: "Dispute quorum resolved", zh: "争议仲裁已达到法定票数" },
  MaintenanceValidated: { en: "Maintenance independently validated", zh: "维护状态已独立验证" }, GrantCreated: { en: "Reward grant created", zh: "奖励计划已创建" },
  MaintenanceRepairRequested: { en: "Maintenance regression requires a replacement artifact", zh: "维护回归失败，已创建修复版本任务" },
  RewardClaimed: { en: "Reward tranche claimed", zh: "阶段奖励已领取" },
};

export function NotificationList({ initial, locale }: { initial: NotificationRow[]; locale: Locale }) {
  const [items, setItems] = useState(initial);
  async function markRead(id: string) {
    const response = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    if (response.ok) setItems((current) => current.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
  }
  if (!items.length) return <div className="card card-pad">{locale === "zh" ? "当前没有链上业务通知。" : "No on-chain business notifications yet."}</div>;
  return <div className="action-stack">{items.map((item) => <div className="card card-pad" key={item.id} style={{ opacity: item.readAt ? 0.68 : 1 }}>
    <div className="eyebrow">{item.kind}</div><h3>{labels[item.kind]?.[locale] ?? item.kind}</h3>
    <p>{new Date(item.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en")}</p>
    <div className="form-actions">
      {item.taskId && <Link className="button button-secondary" href={`/tasks/${item.taskId}`}><ExternalLink size={14} />{locale === "zh" ? "查看任务" : "View task"}</Link>}
      {!item.readAt && <button className="button button-secondary" onClick={() => markRead(item.id)}><Check size={14} />{locale === "zh" ? "标记已读" : "Mark read"}</button>}
    </div>
  </div>)}</div>;
}
