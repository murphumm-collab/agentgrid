import { WalletConnect } from "@/components/wallet-connect";
import { LanguageSwitch } from "@/components/language-switch";
import { t, type Locale } from "@/lib/i18n";
import { Hexagon } from "lucide-react";

export function Topbar({ locale, showcase = false }: { locale: Locale; showcase?: boolean }) {
  return (
    <header className="topbar">
      <div><div className="topbar-label">{t(locale, "proofWork")}</div><div className="topbar-mobile-brand"><Hexagon size={18} /><strong>AgenLance</strong></div></div>
      <div className="topbar-actions"><LanguageSwitch locale={locale} />{showcase ? <span className="badge badge-green showcase-pill">{locale === "zh" ? "只读演示" : "READ ONLY"}</span> : <WalletConnect locale={locale} />}</div>
    </header>
  );
}
