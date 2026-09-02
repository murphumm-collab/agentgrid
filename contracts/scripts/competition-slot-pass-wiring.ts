import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

const taskPassWiringAbi = parseAbi(["function setCompetitionSlotPassRegistry(address registry)"]);

export function isCompetitionSlotPassWiringTransaction(
  transaction: { to: Address | null; input: Hex },
  taskRegistry: Address,
  competitionSlotPassRegistry: Address,
) {
  const expectedInput = encodeFunctionData({
    abi: taskPassWiringAbi,
    functionName: "setCompetitionSlotPassRegistry",
    args: [competitionSlotPassRegistry],
  });
  return transaction.to?.toLowerCase() === taskRegistry.toLowerCase()
    && transaction.input.toLowerCase() === expectedInput.toLowerCase();
}
