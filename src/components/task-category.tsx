import type { Locale } from "@/lib/i18n";

export type TaskCategoryGroup = "ENGINEERING" | "BUSINESS" | "CREATIVE" | "TRUST";

export const taskCategoryGroups: ReadonlyArray<{ id: TaskCategoryGroup; en: string; zh: string }> = [
  { id: "ENGINEERING", en: "Engineering & data", zh: "工程与数据" },
  { id: "BUSINESS", en: "Business & operations", zh: "商业与运营" },
  { id: "CREATIVE", en: "Creative & community", zh: "创意与社区" },
  { id: "TRUST", en: "Trust & quality", zh: "信任与质量" },
];

export const taskCategories = [
  { id: "Development", group: "ENGINEERING", en: "Software development", zh: "软件开发" },
  { id: "Web3", group: "ENGINEERING", en: "Web3 & smart contracts", zh: "Web3 与智能合约" },
  { id: "AI & Agents", group: "ENGINEERING", en: "AI & agents", zh: "AI 与 Agent" },
  { id: "Data", group: "ENGINEERING", en: "Data & analytics", zh: "数据与分析" },
  { id: "Automation", group: "ENGINEERING", en: "Automation & integration", zh: "自动化与集成" },
  { id: "DevOps", group: "ENGINEERING", en: "DevOps & infrastructure", zh: "DevOps 与基础设施" },
  { id: "Research", group: "BUSINESS", en: "Research & strategy", zh: "研究与战略" },
  { id: "Product", group: "BUSINESS", en: "Product management", zh: "产品管理" },
  { id: "Marketing", group: "BUSINESS", en: "Marketing & growth", zh: "市场与增长" },
  { id: "Operations", group: "BUSINESS", en: "Operations & support", zh: "运营与支持" },
  { id: "Finance", group: "BUSINESS", en: "Finance & tokenomics", zh: "财务与代币经济" },
  { id: "Legal", group: "BUSINESS", en: "Legal & compliance", zh: "法律与合规" },
  { id: "Design", group: "CREATIVE", en: "Design & UX", zh: "设计与用户体验" },
  { id: "Content", group: "CREATIVE", en: "Content & localization", zh: "内容与本地化" },
  { id: "Community", group: "CREATIVE", en: "Community & governance", zh: "社区与治理" },
  { id: "Education", group: "CREATIVE", en: "Education & training", zh: "教育与培训" },
  { id: "Security", group: "TRUST", en: "Security & audit", zh: "安全与审计" },
  { id: "Testing", group: "TRUST", en: "Testing & QA", zh: "测试与质量保障" },
] as const satisfies ReadonlyArray<{ id: string; group: TaskCategoryGroup; en: string; zh: string }>;

const categoryById = new Map<string, (typeof taskCategories)[number]>(taskCategories.map((category) => [category.id, category]));
const groupById = new Map<TaskCategoryGroup, (typeof taskCategoryGroups)[number]>(taskCategoryGroups.map((group) => [group.id, group]));

export const primaryTaskCategories: readonly string[] = taskCategories.map((category) => category.id);

export function taskCategoryLabel(category: string, locale: Locale) {
  return categoryById.get(category)?.[locale] ?? category;
}

export function taskCategoryGroup(category: string): TaskCategoryGroup | null {
  return categoryById.get(category)?.group ?? null;
}

export function taskCategoryGroupLabel(group: TaskCategoryGroup, locale: Locale) {
  return groupById.get(group)?.[locale] ?? group;
}

export function TaskCategoryBadge({ category, locale }: { category: string; locale: Locale }) {
  return <span className="badge badge-category">{taskCategoryLabel(category, locale)}</span>;
}
