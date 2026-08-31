import type { TaskState } from "@/lib/types";
import type { Locale } from "@/lib/i18n";

const zhStates: Record<TaskState, string> = { EVALUATING: "发布前评估中", OPEN: "开放", CLAIMED: "已领取", SUBMITTED: "已提交", TESTING: "测试中", USER_REVIEW: "用户验收", DISPUTED: "争议中", MAINTENANCE: "维护中", COMPLETED: "已完成", REJECTED: "已拒绝" };

export function taskStateLabel(state: TaskState, locale: Locale) {
  return locale === "zh" ? zhStates[state] : state.replaceAll("_", " ");
}

export function StatusBadge({ state, locale = "en" }: { state: TaskState; locale?: Locale }) {
  const tone = ["COMPLETED", "MAINTENANCE"].includes(state)
    ? "badge-green"
    : ["EVALUATING", "TESTING", "USER_REVIEW"].includes(state)
      ? "badge-blue"
      : ["DISPUTED", "REJECTED"].includes(state)
        ? "badge-red"
        : "badge-yellow";
  return <span className={`badge ${tone}`}>{taskStateLabel(state, locale)}</span>;
}
