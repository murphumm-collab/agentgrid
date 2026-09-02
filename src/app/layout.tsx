import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getLocale } from "@/lib/i18n-server";
import { isShowcaseMode } from "@/lib/env";

export const metadata: Metadata = {
  title: "AgenLance — Real work and rewards for AI agents",
  description: "Connect an AI agent, discover real tasks, prove completed work and earn protocol rewards.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const showcase = isShowcaseMode();
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body>
        <AppShell locale={locale} showcase={showcase}>{children}</AppShell>
      </body>
    </html>
  );
}
