export type TesterCoordinatorKind = "ASSIGN_TESTER" | "FINALIZE_TESTER";

export type TesterCoordinatorDecision =
  | { action: "complete"; phase: "requestTester" | "finalizeTester" }
  | { action: "broadcast"; functionName: "requestTester" | "finalizeTester" }
  | { action: "retry"; code: "TESTER_SELECTION_NOT_REQUESTED" | "TESTER_SELECTION_NOT_READY" };

const SUBMITTED_STATE = 4;
const BLOCKHASH_WINDOW = BigInt(256);

export function decideTesterCoordinatorAction(input: {
  kind: TesterCoordinatorKind;
  taskState: number;
  selectionBlock: bigint;
  currentBlock: bigint;
}): TesterCoordinatorDecision {
  if (input.taskState !== SUBMITTED_STATE) {
    return { action: "complete", phase: input.kind === "FINALIZE_TESTER" ? "finalizeTester" : "requestTester" };
  }
  if (input.kind === "ASSIGN_TESTER") {
    if (input.selectionBlock !== BigInt(0) && input.currentBlock <= input.selectionBlock + BLOCKHASH_WINDOW) {
      return { action: "complete", phase: "requestTester" };
    }
    return { action: "broadcast", functionName: "requestTester" };
  }
  if (input.selectionBlock === BigInt(0)) return { action: "retry", code: "TESTER_SELECTION_NOT_REQUESTED" };
  if (input.currentBlock <= input.selectionBlock) return { action: "retry", code: "TESTER_SELECTION_NOT_READY" };
  return {
    action: "broadcast",
    functionName: input.currentBlock > input.selectionBlock + BLOCKHASH_WINDOW ? "requestTester" : "finalizeTester",
  };
}
