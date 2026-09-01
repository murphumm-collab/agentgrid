import type { CSSProperties, ReactNode } from "react";

export type ActionResult = { tone: "success" | "error"; message: string };

export function actionNoticeAccessibility(tone: ActionResult["tone"]) {
  return tone === "error"
    ? { role: "alert" as const, "aria-live": "assertive" as const }
    : { role: "status" as const, "aria-live": "polite" as const };
}

export function ActionNotice({ tone, children, style }: {
  tone: ActionResult["tone"];
  children: ReactNode;
  style?: CSSProperties;
}) {
  return <div className={`notice ${tone}`} {...actionNoticeAccessibility(tone)} style={style}>{children}</div>;
}
