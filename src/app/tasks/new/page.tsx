import { NewTaskForm } from "@/components/new-task-form";
import { protocolSnapshot } from "@/lib/service";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { readWalletSession } from "@/lib/auth";
import { isProductionMode } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const snapshot = await protocolSnapshot();
  const locale = await getLocale();
  const owner = isProductionMode() ? (await readWalletSession())?.address : "0xDemoPublisher";
  const production = isProductionMode();
  return <><div className="page-head"><div><div className="eyebrow">{t(locale, "useCredit")}</div><h1>{t(locale, "publishOutcome")}</h1><p className="lead">{t(locale, "publishLead")}</p></div></div><NewTaskForm positions={owner ? snapshot.positions.filter((position) => position.owner.toLowerCase() === owner.toLowerCase()) : []} publisher={owner ?? ""} locale={locale} production={production} /></>;
}
