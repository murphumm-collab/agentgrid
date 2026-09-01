import { describe, expect, it } from "vitest";
import { dueVerificationLifecycleAction } from "./verification-lifecycle";

const base = { epoch: 7, commitDeadline: 100n, revealDeadline: 200n, challengeDeadline: 300n };

describe("verification lifecycle scheduling", () => {
  it("schedules exact commit/reveal expiry and challenge finalization only after the chain deadline", () => {
    expect(dueVerificationLifecycleAction({ now: 101n, panel: { ...base, status: 1 } })).toEqual({ kind: "EXPIRE_VERIFICATION_PANEL", panelEpoch: 7, dueAt: 100n });
    expect(dueVerificationLifecycleAction({ now: 201n, panel: { ...base, status: 2 } })).toEqual({ kind: "EXPIRE_VERIFICATION_PANEL", panelEpoch: 7, dueAt: 200n });
    expect(dueVerificationLifecycleAction({ now: 301n, panel: { ...base, status: 3 } })).toEqual({ kind: "FINALIZE_VERIFICATION_PANEL", panelEpoch: 7, dueAt: 300n });
    expect(dueVerificationLifecycleAction({ now: 300n, panel: { ...base, status: 3 } })).toBeNull();
  });

  it("expires only the unresolved active arbitration case and ignores terminal panels", () => {
    const caseId = `0x${"a".repeat(64)}` as const;
    expect(dueVerificationLifecycleAction({ now: 401n, panel: { ...base, status: 4 }, activeCase: { caseId, deadline: 400n, resolved: false } })).toEqual({ kind: "EXPIRE_VERIFICATION_ARBITRATION", caseId, dueAt: 400n });
    expect(dueVerificationLifecycleAction({ now: 401n, panel: { ...base, status: 4 }, activeCase: { caseId, deadline: 400n, resolved: true } })).toBeNull();
    expect(dueVerificationLifecycleAction({ now: 999n, panel: { ...base, status: 5 } })).toBeNull();
  });
});
