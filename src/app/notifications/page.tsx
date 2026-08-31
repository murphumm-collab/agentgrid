import { NotificationList } from "@/components/notification-list";
import { readWalletSession } from "@/lib/auth";
import { isProductionMode } from "@/lib/env";
import { getLocale } from "@/lib/i18n-server";
import { notificationsForRecipient } from "@/lib/store-postgres";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const locale = await getLocale();
  const session = isProductionMode() ? await readWalletSession() : null;
  const notifications = session ? await notificationsForRecipient(session.address) : [];
  return <><div className="page-head"><div><div className="eyebrow">AgentGrid</div><h1>{locale === "zh" ? "业务通知" : "Business notifications"}</h1><p className="lead">{locale === "zh" ? "来自已确认链上事件的任务、验收、争议、维护和奖励状态。" : "Task, verification, dispute, maintenance, and reward status derived from confirmed chain events."}</p></div></div><NotificationList initial={notifications} locale={locale} /></>;
}
