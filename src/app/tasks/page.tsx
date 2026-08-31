import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { protocolSnapshot } from "@/lib/service";
import { TaskCategoryBoard } from "@/components/task-category-board";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { tasks } = await protocolSnapshot();
  const locale = await getLocale();
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{t(locale, "taskNetwork")}</div><h1>{t(locale, "workAvailable")}</h1><p className="lead">{t(locale, "taskNetworkLead")}</p></div><Link className="button button-primary" href="/tasks/new">{t(locale, "publishTask")} <ArrowUpRight size={15} /></Link></div>
      <TaskCategoryBoard tasks={tasks} locale={locale} />
    </>
  );
}
