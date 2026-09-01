import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(filename: string) {
  return readFileSync(new URL(filename, import.meta.url), "utf8");
}

describe("frontend async controls", () => {
  it("fails language writes visibly and never refreshes a rejected response", () => {
    const text = source("language-switch.tsx");
    expect(text).toContain("if (!response.ok) throw");
    expect(text.indexOf("if (!response.ok) throw")).toBeLessThan(text.indexOf("router.refresh()"));
    expect(text).toContain("inFlight.current");
    expect(text).toContain("aria-busy={busy}");
    expect(text).toContain("aria-pressed=");
  });

  it("turns clipboard rejection into an accessible result with a duplicate guard", () => {
    const text = source("code-example.tsx");
    expect(text).toContain("navigator.clipboard.writeText(code)");
    expect(text).toContain("catch {");
    expect(text).toContain('tone: "error"');
    expect(text).toContain("inFlight.current");
    expect(text).toContain("aria-busy={busy}");
  });

  it("shares one busy and duplicate boundary across Demo stake and faucet writes", () => {
    const text = source("stake-form.tsx");
    expect(text.match(/if \(inFlight\.current\) return;/g)).toHaveLength(2);
    expect(text).toContain("response.json().catch");
    expect(text.match(/aria-busy=\{busy\}/g)).toHaveLength(2);
    expect(text).toContain('tone: "error"');
  });

  it("guards task publication before React commits disabled state and announces outcomes structurally", () => {
    const text = source("new-task-form.tsx");
    expect(text).toContain("if (submitInFlight.current) return;");
    expect(text).toContain("submitInFlight.current = true;");
    expect(text).toContain("submitInFlight.current = false;");
    expect(text).toContain("aria-busy={submitting}");
    expect(text).toContain('<ActionNotice tone="error"');
    expect(text).toContain('<ActionNotice tone="success"');
  });
});
