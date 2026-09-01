import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mobilePrimaryNavigationHrefs } from "./sidebar";

describe("Sidebar navigation", () => {
  it("keeps the AI Dashboard in the bounded mobile primary navigation", () => {
    expect(mobilePrimaryNavigationHrefs).toEqual([
      "/", "/dashboard", "/tasks", "/tasks/new", "/agents", "/proofs",
    ]);

    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.mobile-nav\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).toMatch(/\.mobile-nav-link\s*\{[^}]*min-width:\s*0/s);
  });
});
