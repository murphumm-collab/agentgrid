export type LifecycleTimeoutAction = "REPLACE_TESTER" | "FINALIZE_PUBLISHER_REVIEW";

export function lifecycleTimeoutAction(state: number, deadline: number, now: number): LifecycleTimeoutAction | null {
  if (deadline === 0 || now < deadline) return null;
  if (state === 5) return "REPLACE_TESTER";
  if (state === 7) return "FINALIZE_PUBLISHER_REVIEW";
  return null;
}
