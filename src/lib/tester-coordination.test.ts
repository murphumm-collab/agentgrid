import { describe, expect, it } from "vitest";
import { decideTesterCoordinatorAction } from "./tester-coordination";

describe("tester coordinator decision", () => {
  it("idempotently completes jobs after the task leaves Submitted", () => {
    expect(decideTesterCoordinatorAction({ kind: "ASSIGN_TESTER", taskState: 5, selectionBlock: 0n, currentBlock: 1n }))
      .toEqual({ action: "complete", phase: "requestTester" });
    expect(decideTesterCoordinatorAction({ kind: "FINALIZE_TESTER", taskState: 5, selectionBlock: 10n, currentBlock: 20n }))
      .toEqual({ action: "complete", phase: "finalizeTester" });
  });

  it("does not repeat an active assignment request", () => {
    expect(decideTesterCoordinatorAction({ kind: "ASSIGN_TESTER", taskState: 4, selectionBlock: 100n, currentBlock: 101n }))
      .toEqual({ action: "complete", phase: "requestTester" });
  });

  it("waits for future entropy and finalizes inside the blockhash window", () => {
    expect(decideTesterCoordinatorAction({ kind: "FINALIZE_TESTER", taskState: 4, selectionBlock: 100n, currentBlock: 100n }))
      .toEqual({ action: "retry", code: "TESTER_SELECTION_NOT_READY" });
    expect(decideTesterCoordinatorAction({ kind: "FINALIZE_TESTER", taskState: 4, selectionBlock: 100n, currentBlock: 101n }))
      .toEqual({ action: "broadcast", functionName: "finalizeTester" });
    expect(decideTesterCoordinatorAction({ kind: "FINALIZE_TESTER", taskState: 4, selectionBlock: 100n, currentBlock: 356n }))
      .toEqual({ action: "broadcast", functionName: "finalizeTester" });
  });

  it("redraws only after objective expiry and never because of a write failure", () => {
    expect(decideTesterCoordinatorAction({ kind: "FINALIZE_TESTER", taskState: 4, selectionBlock: 100n, currentBlock: 357n }))
      .toEqual({ action: "broadcast", functionName: "requestTester" });
    expect(decideTesterCoordinatorAction({ kind: "FINALIZE_TESTER", taskState: 4, selectionBlock: 0n, currentBlock: 357n }))
      .toEqual({ action: "retry", code: "TESTER_SELECTION_NOT_REQUESTED" });
  });
});
