import { describe, expect, it } from "vitest";
import { lifecycleTimeoutAction } from "./lifecycle-timeouts";

describe("lifecycle timeout policy", () => {
  it("acts at the exact deadline only for testing and user review", () => {
    expect(lifecycleTimeoutAction(5, 100, 99)).toBeNull();
    expect(lifecycleTimeoutAction(5, 100, 100)).toBe("REPLACE_TESTER");
    expect(lifecycleTimeoutAction(7, 100, 100)).toBe("FINALIZE_PUBLISHER_REVIEW");
    expect(lifecycleTimeoutAction(5, 0, 1_000)).toBeNull();
    expect(lifecycleTimeoutAction(8, 100, 1_000)).toBeNull();
  });
});
