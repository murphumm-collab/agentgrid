import type { PublicTaskPromotion } from "./task-promotion";

export function promotionApplies(promotion: PublicTaskPromotion | undefined, surface: "HOMEPAGE" | { category: string }, now = new Date()) {
  if (!promotion || now.getTime() < Date.parse(promotion.startsAt) || now.getTime() >= Date.parse(promotion.endsAt)) return false;
  return surface === "HOMEPAGE"
    ? promotion.placement === "HOMEPAGE"
    : promotion.placement === "CATEGORY" && promotion.category === surface.category;
}

export function rankMarketplaceTasks<T extends { promotion?: PublicTaskPromotion }>(tasks: T[], surface: "HOMEPAGE" | { category: string }, now = new Date()) {
  return tasks.map((task, index) => ({ task, index, promoted: promotionApplies(task.promotion, surface, now) }))
    .sort((left, right) => Number(right.promoted) - Number(left.promoted) || left.index - right.index)
    .map(({ task }) => task);
}
