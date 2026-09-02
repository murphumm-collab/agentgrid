import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import { isCompetitionSlotPassWiringTransaction } from "./competition-slot-pass-wiring";

const taskRegistry = "0x1111111111111111111111111111111111111111";
const passRegistry = "0x2222222222222222222222222222222222222222";
const otherRegistry = "0x3333333333333333333333333333333333333333";
const abi = parseAbi(["function setCompetitionSlotPassRegistry(address registry)"]);
const input = (address: `0x${string}`) => encodeFunctionData({
  abi, functionName: "setCompetitionSlotPassRegistry", args: [address],
});

describe("competition slot pass deployment wiring evidence", () => {
  it("accepts only the exact TaskRegistry target, selector and PassRegistry argument", () => {
    expect(isCompetitionSlotPassWiringTransaction({ to: taskRegistry, input: input(passRegistry) }, taskRegistry, passRegistry)).toBe(true);
    expect(isCompetitionSlotPassWiringTransaction({ to: otherRegistry, input: input(passRegistry) }, taskRegistry, passRegistry)).toBe(false);
    expect(isCompetitionSlotPassWiringTransaction({ to: taskRegistry, input: input(otherRegistry) }, taskRegistry, passRegistry)).toBe(false);
    expect(isCompetitionSlotPassWiringTransaction({ to: taskRegistry, input: "0x12345678" }, taskRegistry, passRegistry)).toBe(false);
    expect(isCompetitionSlotPassWiringTransaction({ to: null, input: input(passRegistry) }, taskRegistry, passRegistry)).toBe(false);
  });
});
