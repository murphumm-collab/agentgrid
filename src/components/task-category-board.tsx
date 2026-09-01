"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BadgeDollarSign, Clock3, LayoutGrid, Users } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { TaskCategoryBadge, primaryTaskCategories, taskCategories, taskCategoryGroup, taskCategoryGroupLabel, taskCategoryGroups, taskCategoryLabel, type TaskCategoryGroup } from "@/components/task-category";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import type { Task } from "@/lib/types";
import { isPublicTask } from "@/lib/public-task-view";
import { rankMarketplaceTasks } from "@/lib/marketplace-ranking";

const ALL = "__all__";
type GroupFilter = TaskCategoryGroup | typeof ALL;

export function TaskCategoryBoard({ tasks, locale }: { tasks: Task[]; locale: Locale }) {
  const [selectedCategory, setSelectedCategory] = useState(ALL);
  const [selectedGroup, setSelectedGroup] = useState<GroupFilter>(ALL);
  // Defense in depth: private evaluation requests and rejected tasks are never marketplace inventory.
  const marketTasks = useMemo(() => tasks.filter(isPublicTask), [tasks]);
  const categories = useMemo(() => {
    const observed = [...new Set(marketTasks.map((task) => task.category).filter(Boolean))];
    return [...primaryTaskCategories, ...observed.filter((category) => !primaryTaskCategories.includes(category))];
  }, [marketTasks]);
  const counts = useMemo(() => new Map(categories.map((category) => [category, marketTasks.filter((task) => task.category === category).length])), [categories, marketTasks]);
  const groupCategories = selectedGroup === ALL ? categories : categories.filter((category) => taskCategoryGroup(category) === selectedGroup);
  const filteredTasks = marketTasks.filter((task) => {
    if (selectedCategory !== ALL) return task.category === selectedCategory;
    return selectedGroup === ALL || taskCategoryGroup(task.category) === selectedGroup;
  });
  const visibleTasks = rankMarketplaceTasks(filteredTasks, selectedCategory === ALL ? "HOMEPAGE" : { category: selectedCategory });

  function selectGroup(group: GroupFilter) {
    setSelectedGroup(group);
    setSelectedCategory(ALL);
  }

  return (
    <>
      <section className="category-board" aria-labelledby="task-categories-title">
        <div className="section-head category-board-head">
          <div>
            <div className="eyebrow">{locale === "zh" ? "任务市场" : "Task marketplace"}</div>
            <h2 className="section-title" id="task-categories-title">{locale === "zh" ? "任务分类" : "Task categories"}</h2>
          </div>
          <span className="badge"><LayoutGrid size={12} /> {marketTasks.length} {locale === "zh" ? "个任务" : "tasks"}</span>
        </div>
        <div className="category-group-filter" role="group" aria-label={locale === "zh" ? "按分类领域筛选" : "Filter by category group"}>
          <button className={`category-group-chip ${selectedGroup === ALL ? "active" : ""}`} type="button" aria-pressed={selectedGroup === ALL} onClick={() => selectGroup(ALL)}>{locale === "zh" ? "全部领域" : "All areas"}</button>
          {taskCategoryGroups.map((group) => (
            <button className={`category-group-chip ${selectedGroup === group.id ? "active" : ""}`} type="button" aria-pressed={selectedGroup === group.id} onClick={() => selectGroup(group.id)} key={group.id}>
              {taskCategoryGroupLabel(group.id, locale)}
              <strong>{taskCategories.filter((category) => category.group === group.id).reduce((total, category) => total + (counts.get(category.id) ?? 0), 0)}</strong>
            </button>
          ))}
        </div>
        <div className="category-filter" role="group" aria-label={locale === "zh" ? "按任务分类筛选" : "Filter by task category"}>
          <button className={`category-filter-card ${selectedCategory === ALL ? "active" : ""}`} type="button" aria-pressed={selectedCategory === ALL} onClick={() => setSelectedCategory(ALL)}>
            <span>{selectedGroup === ALL ? (locale === "zh" ? "全部任务" : "All tasks") : taskCategoryGroupLabel(selectedGroup, locale)}</span><strong>{selectedGroup === ALL ? marketTasks.length : marketTasks.filter((task) => taskCategoryGroup(task.category) === selectedGroup).length}</strong>
          </button>
          {groupCategories.map((category) => (
            <button className={`category-filter-card ${selectedCategory === category ? "active" : ""}`} type="button" aria-pressed={selectedCategory === category} onClick={() => setSelectedCategory(category)} key={category}>
              <span>{taskCategoryLabel(category, locale)}</span><strong>{counts.get(category) ?? 0}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="card card-pad">
        <div className="section-head">
          <h2 className="section-title">{selectedCategory !== ALL ? taskCategoryLabel(selectedCategory, locale) : selectedGroup !== ALL ? taskCategoryGroupLabel(selectedGroup, locale) : (locale === "zh" ? "全部任务" : "All tasks")}</h2>
          <span className="badge badge-blue">{visibleTasks.length} {locale === "zh" ? "个结果" : "results"}</span>
        </div>
        {visibleTasks.length ? (
          <div className="task-list">
            {visibleTasks.map((task) => <Link className="task-row" href={`/tasks/${task.id}`} key={task.id}><div><div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}><StatusBadge state={task.state} locale={locale} /><TaskCategoryBadge category={task.category} locale={locale} />{task.promotion ? <span className="badge sponsored-badge" title={locale === "zh" ? "付费展示，不影响协议选人、质量排名、验证或仲裁" : "Paid placement; no effect on protocol selection, quality, verification or arbitration"}><BadgeDollarSign size={12} />{locale === "zh" ? "赞助" : "Sponsored"}</span> : null}</div><h3 className="task-title" style={{ fontSize: 17 }}>{task.title}</h3><p className="lead" style={{ fontSize: 12 }}>{task.description}</p><div className="task-meta"><span><Clock3 size={11} /> {task.declaredDurationHours} {t(locale, "hours")}</span><span><Users size={11} /> {task.executorIds.length}/{task.maxExecutors} {t(locale, "executors")}</span><span>{t(locale, "deadline")} {formatDate(task.deadlineAt, locale)}</span></div></div><div className="task-side">{task.promotion ? <small>{locale === "zh" ? `展示至 ${formatDate(task.promotion.endsAt, locale)}` : `Placement ends ${formatDate(task.promotion.endsAt, locale)}`}</small> : null}<ArrowUpRight size={18} color="var(--accent)" /></div></Link>)}
          </div>
        ) : <div className="category-empty"><LayoutGrid size={24} /><strong>{locale === "zh" ? "这个分类暂时没有任务" : "No tasks in this category yet"}</strong><span>{locale === "zh" ? "可以切换分类，或发布第一个任务。" : "Choose another category or publish the first task."}</span></div>}
      </section>
    </>
  );
}
