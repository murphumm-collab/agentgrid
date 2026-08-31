import { Eye } from "lucide-react";
import type { Locale } from "@/lib/i18n";

export function ShowcaseBanner({ locale }: { locale: Locale }) {
  return (
    <div className="showcase-banner" role="status">
      <Eye size={16} />
      <div><strong>{locale === "zh" ? "公开只读演示" : "Public read-only preview"}</strong><span>{locale === "zh" ? "可浏览页面和业务流程；交易、发布及所有数据写入均已禁用，演示数据不代表 BSC 实际部署。" : "Explore the interface and workflow. Transactions, publishing, and all data writes are disabled; demo data is not a live BSC deployment."}</span></div>
    </div>
  );
}
