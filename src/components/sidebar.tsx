import Link from "next/link";
import { Activity, Bell, Bot, Boxes, Braces, Coins, FileCheck2, Gauge, Hexagon, ListChecks, ShieldCheck, Sparkles } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";

export const mobilePrimaryNavigationHrefs: readonly string[] = ["/", "/dashboard", "/tasks", "/tasks/new", "/agents", "/proofs"];

export function Sidebar({ locale }: { locale: Locale }) {
  const links = [
    { href: "/", label: t(locale, "overview"), icon: Gauge }, { href: "/dashboard", label: locale === "zh" ? "AI 面板" : "AI Dashboard", icon: Sparkles }, { href: "/tasks", label: t(locale, "tasks"), icon: ListChecks },
    { href: "/tasks/new", label: t(locale, "publish"), icon: Boxes }, { href: "/stake", label: t(locale, "stakeCredit"), icon: Coins },
    { href: "/agents", label: t(locale, "agents"), icon: Bot }, { href: "/agents/integration", label: t(locale, "agentApi"), icon: Braces }, { href: "/proofs", label: locale === "zh" ? "完成证明" : "Proofs", icon: FileCheck2 }, { href: "/notifications", label: locale === "zh" ? "通知" : "Notifications", icon: Bell }, { href: "/protocol", label: t(locale, "protocol"), icon: Activity },
  ];
  return (
    <>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark"><Hexagon size={21} strokeWidth={2.5} /></span>
          <span><div className="brand-name">AgentGrid</div><div className="brand-tag">{t(locale, "maintenanceProtocol")}</div></span>
        </Link>
        <nav className="nav" aria-label={t(locale, "primaryNavigation")}>
          {links.map(({ href, label, icon: Icon }) => (
            <Link className="nav-link" href={href} key={href}><Icon size={17} />{label}</Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="network-card">
            <div className="network-row"><span className="pulse" /><strong>{t(locale, "bscTestnet")}</strong><ShieldCheck size={14} style={{ marginLeft: "auto" }} /></div>
            <div className="network-meta">{t(locale, "chainReady")}</div>
          </div>
        </div>
      </aside>
      <nav className="mobile-nav" aria-label={locale === "zh" ? "手机端主要导航" : "Mobile primary navigation"}>
        {links.filter(({ href }) => mobilePrimaryNavigationHrefs.includes(href)).map(({ href, label, icon: Icon }) => (
          <Link className="mobile-nav-link" href={href} key={href}><Icon size={19} /><span>{label}</span></Link>
        ))}
      </nav>
    </>
  );
}
