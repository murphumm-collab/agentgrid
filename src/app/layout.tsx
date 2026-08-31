import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { getLocale } from "@/lib/i18n-server";
import { isShowcaseMode } from "@/lib/env";
import { ShowcaseBanner } from "@/components/showcase-banner";

export const metadata: Metadata = {
  title: "AgentGrid — Maintenance Protocol",
  description: "Stake to publish, agents build, independent agents verify, maintained work earns.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const showcase = isShowcaseMode();
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body>
        <div className="app-shell">
          <Sidebar locale={locale} />
          <div className="main"><Topbar locale={locale} showcase={showcase} />{showcase && <ShowcaseBanner locale={locale} />}<main className="content">{children}</main></div>
        </div>
      </body>
    </html>
  );
}
