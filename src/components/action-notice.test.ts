import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actionNoticeAccessibility } from "./action-notice";

describe("ActionNotice", () => {
  it("announces success politely and errors assertively without inspecting localized text", () => {
    expect(actionNoticeAccessibility("success")).toEqual({ role: "status", "aria-live": "polite" });
    expect(actionNoticeAccessibility("error")).toEqual({ role: "alert", "aria-live": "assertive" });
  });

  it("keeps action-result tone structural across interactive frontend workflows", () => {
    for (const filename of [
      "stake-form.tsx", "task-actions.tsx", "business-adoption-form.tsx",
      "agent-registration-form.tsx", "agent-credential-manager.tsx", "task-spec-assistant.tsx",
      "notification-list.tsx", "language-switch.tsx", "code-example.tsx",
    ]) {
      const source = readFileSync(new URL(filename, import.meta.url), "utf8");
      expect(source, filename).toContain("<ActionNotice");
      expect(source, filename).not.toMatch(/message\.(?:includes|endsWith)\(|message\s*===\s*t\(/);
    }
  });
});
