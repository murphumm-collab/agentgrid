import { describe, expect, it } from "vitest";
import { primaryTaskCategories, taskCategories, taskCategoryGroup, taskCategoryGroupLabel, taskCategoryGroups, taskCategoryLabel } from "./task-category";

describe("task category taxonomy", () => {
  it("exposes eighteen unique detailed categories across four groups", () => {
    expect(taskCategories).toHaveLength(18);
    expect(new Set(primaryTaskCategories).size).toBe(18);
    expect(taskCategoryGroups).toHaveLength(4);
    expect(new Set(taskCategories.map((category) => category.group))).toEqual(new Set(taskCategoryGroups.map((group) => group.id)));
  });

  it("returns bilingual labels and preserves unknown evaluated categories", () => {
    expect(taskCategoryLabel("Web3", "zh")).toBe("Web3 与智能合约");
    expect(taskCategoryLabel("Testing", "en")).toBe("Testing & QA");
    expect(taskCategoryGroup("AI & Agents")).toBe("ENGINEERING");
    expect(taskCategoryGroupLabel("TRUST", "zh")).toBe("信任与质量");
    expect(taskCategoryLabel("Specialized science", "zh")).toBe("Specialized science");
    expect(taskCategoryGroup("Specialized science")).toBeNull();
  });
});
