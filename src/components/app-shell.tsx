"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { ShowcaseBanner } from "@/components/showcase-banner";
import { Topbar } from "@/components/topbar";
import type { Locale } from "@/lib/i18n";

export function AppShell({ children, locale, showcase }: { children: ReactNode; locale: Locale; showcase: boolean }) {
  const pathname = usePathname();

  if (pathname === "/") return <>{children}</>;

  return (
    <div className="app-shell">
      <Sidebar locale={locale} />
      <div className="main">
        <Topbar locale={locale} showcase={showcase} />
        {showcase && <ShowcaseBanner locale={locale} />}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
