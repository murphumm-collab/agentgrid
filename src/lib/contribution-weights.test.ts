import { describe, expect, it } from "vitest";
import { calculateContributionWeights, contributionFormulaVersion } from "./contribution-weights";

const manifest = (files: Array<{ path: string; content: string }>) => ({ summary: "A sufficiently detailed project summary", files });

describe("calculateContributionWeights", () => {
  it("rewards only work incorporated into the final artifact and credits integration", () => {
    const final = manifest([{ path: "package.json", content: "pkg" }, { path: "src/a.js", content: "a".repeat(100) }, { path: "test/a.test.js", content: "t".repeat(100) }]);
    const weights = calculateContributionWeights(final, [
      { contributor: "0xLead", manifest: manifest([{ path: "package.json", content: "pkg" }, { path: "src/a.js", content: "a".repeat(100) }]) },
      { contributor: "0xPeer", manifest: manifest([{ path: "test/a.test.js", content: "t".repeat(100) }, { path: "src/rejected.js", content: "unused" }]) },
    ], "0xLead");
    expect(weights.reduce((sum, item) => sum + item.weightBps, 0)).toBe(10_000);
    expect(weights[0].weightBps).toBeGreaterThan(weights[1].weightBps);
    expect(weights[1].acceptedFiles).toBe(1);
  });

  it("splits duplicate claims instead of double counting them", () => {
    const final = manifest([{ path: "src/shared.js", content: "same".repeat(100) }]);
    const weights = calculateContributionWeights(final, [
      { contributor: "0xA", manifest: final },
      { contributor: "0xB", manifest: final },
    ], "0xA");
    expect(weights.reduce((sum, item) => sum + item.weightBps, 0)).toBe(10_000);
    expect(weights[0].acceptedBytes).toBeGreaterThan(weights[1].acceptedBytes);
  });

  it("caps filler bytes per file and contributor under the versioned formula", () => {
    const huge = "x".repeat(2_000_000);
    const final = manifest(Array.from({ length: 12 }, (_, index) => ({ path: `src/filler-${index}.js`, content: huge })));
    const weights = calculateContributionWeights(final, [{ contributor: "0xA", manifest: final }], "0xA");
    expect(contributionFormulaVersion).toBe("incorporated-bytes-v2");
    expect(weights[0].acceptedBytes).toBe(512 * 1024);
    expect(weights[0].weightBps).toBe(10_000);
  });
});
