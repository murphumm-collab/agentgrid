export type VerificationLifecycleAction =
  | { kind: "EXPIRE_VERIFICATION_PANEL"; panelEpoch: number; dueAt: bigint }
  | { kind: "FINALIZE_VERIFICATION_PANEL"; panelEpoch: number; dueAt: bigint }
  | { kind: "EXPIRE_VERIFICATION_ARBITRATION"; caseId: `0x${string}`; dueAt: bigint };

export function dueVerificationLifecycleAction(input: {
  now: bigint;
  panel: { status: number; epoch: number; commitDeadline: bigint; revealDeadline: bigint; challengeDeadline: bigint };
  activeCase?: { caseId: `0x${string}`; deadline: bigint; resolved: boolean };
}): VerificationLifecycleAction | null {
  const { now, panel, activeCase } = input;
  if (panel.status === 1 && panel.commitDeadline < now) {
    return { kind: "EXPIRE_VERIFICATION_PANEL", panelEpoch: panel.epoch, dueAt: panel.commitDeadline };
  }
  if (panel.status === 2 && panel.revealDeadline < now) {
    return { kind: "EXPIRE_VERIFICATION_PANEL", panelEpoch: panel.epoch, dueAt: panel.revealDeadline };
  }
  if (panel.status === 3 && panel.challengeDeadline < now) {
    return { kind: "FINALIZE_VERIFICATION_PANEL", panelEpoch: panel.epoch, dueAt: panel.challengeDeadline };
  }
  if (panel.status === 4 && activeCase && !activeCase.resolved && activeCase.deadline < now) {
    return { kind: "EXPIRE_VERIFICATION_ARBITRATION", caseId: activeCase.caseId, dueAt: activeCase.deadline };
  }
  return null;
}
