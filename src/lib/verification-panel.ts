import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import { z } from "zod";
import { verificationArbitrationPolicySchema, verificationArbitrationPolicy } from "./verification-arbitration";

export const verificationPanelSize = 3 as const;
export const verificationOrderWeightsBps = [4_000, 3_333, 2_667] as const;

export const verificationShardSchema = z.object({
  shard: z.number().int().min(0).max(2),
  criterionIds: z.array(z.string().regex(/^criterion-[1-9][0-9]{0,1}$/)).min(1).max(12),
}).strict();

export const verificationPlanSchema = z.object({
  panelSize: z.literal(verificationPanelSize),
  disclosure: z.literal("COMMIT_THEN_REVEAL"),
  aggregation: z.literal("TWO_OF_THREE_PER_CRITERION"),
  orderWeightsBps: z.tuple([z.literal(4_000), z.literal(3_333), z.literal(2_667)]),
  arbitration: verificationArbitrationPolicySchema,
  shards: z.tuple([verificationShardSchema, verificationShardSchema, verificationShardSchema]),
}).strict().superRefine((plan, context) => {
  plan.shards.forEach((item, index) => {
    if (item.shard !== index) context.addIssue({ code: "custom", path: ["shards", index, "shard"], message: "VERIFICATION_SHARD_ORDER_INVALID" });
    if (new Set(item.criterionIds).size !== item.criterionIds.length) context.addIssue({ code: "custom", path: ["shards", index, "criterionIds"], message: "VERIFICATION_SHARD_CRITERION_DUPLICATE" });
  });
});

export type VerificationPlan = z.infer<typeof verificationPlanSchema>;

export function createVerificationPlan(criterionIds: string[]): VerificationPlan {
  if (criterionIds.length < 2 || new Set(criterionIds).size !== criterionIds.length) throw new Error("VERIFICATION_CRITERIA_INVALID");
  const shards = Array.from({ length: verificationPanelSize }, (_, shard) => ({
    shard,
    criterionIds: criterionIds.filter((_, index) => shard === index % verificationPanelSize || shard === (index + 1) % verificationPanelSize),
  }));
  // With only two criteria, the third shard would otherwise be empty. Duplicate
  // authority is intentional; no shard ever receives the whole required set.
  shards.forEach((item, shard) => { if (item.criterionIds.length === 0) item.criterionIds.push(criterionIds[shard % criterionIds.length]); });
  return verificationPlanSchema.parse({
    panelSize: verificationPanelSize,
    disclosure: "COMMIT_THEN_REVEAL",
    aggregation: "TWO_OF_THREE_PER_CRITERION",
    orderWeightsBps: [...verificationOrderWeightsBps],
    arbitration: verificationArbitrationPolicy,
    shards,
  });
}

export function assertVerificationCoverage(plan: VerificationPlan, requiredCriterionIds: string[]) {
  const parsed = verificationPlanSchema.parse(plan);
  const known = new Set(requiredCriterionIds);
  for (const shard of parsed.shards) for (const id of shard.criterionIds) if (!known.has(id)) throw new Error(`VERIFICATION_CRITERION_UNKNOWN:${id}`);
  for (const id of requiredCriterionIds) {
    const count = parsed.shards.filter((shard) => shard.criterionIds.includes(id)).length;
    if (count !== 2) throw new Error(`VERIFICATION_CROSS_COVERAGE_INVALID:${id}`);
  }
  // Two criteria cannot both have two-of-three coverage without one overlap
  // shard seeing both criterion labels. Runtime test-file isolation remains
  // mandatory; for three or more criteria the plan also forbids full scope.
  if (requiredCriterionIds.length >= 3 && parsed.shards.some((shard) => requiredCriterionIds.every((id) => shard.criterionIds.includes(id)))) throw new Error("VERIFICATION_FULL_SCOPE_FORBIDDEN");
  return parsed;
}

export function verificationCommitment(input: { taskId: string; workRound: number; shard: number; reportHash: string; salt: string }) {
  return keccak256(stringToHex(JSON.stringify({
    domain: "AgentGrid Verification Shard Commitment V1",
    taskId: input.taskId,
    workRound: input.workRound,
    shard: input.shard,
    reportHash: input.reportHash.toLowerCase(),
    salt: input.salt.toLowerCase(),
  })));
}

export function aggregateCriterionVotes(input: Array<{ shard: number; criterionId: string; passed: boolean }>, requiredCriterionIds: string[]) {
  return requiredCriterionIds.map((criterionId) => {
    const votes = input.filter((vote) => vote.criterionId === criterionId);
    if (new Set(votes.map((vote) => vote.shard)).size !== 2) throw new Error(`VERIFICATION_VOTE_COUNT_INVALID:${criterionId}`);
    return { criterionId, passed: votes.filter((vote) => vote.passed).length === 2 };
  });
}

export function aggregateExecutorWeights(reports: Array<{ commitOrder: number; executorWeightsBps: number[] }>) {
  if (reports.length !== verificationPanelSize || new Set(reports.map((report) => report.commitOrder)).size !== verificationPanelSize) throw new Error("VERIFICATION_PANEL_INCOMPLETE");
  const width = reports[0].executorWeightsBps.length;
  if (!width || reports.some((report) => report.executorWeightsBps.length !== width || report.executorWeightsBps.reduce((sum, value) => sum + value, 0) !== 10_000)) throw new Error("VERIFICATION_EXECUTOR_WEIGHTS_INVALID");
  const raw = Array.from({ length: width }, (_, executor) => reports.reduce((sum, report) => sum + report.executorWeightsBps[executor] * verificationOrderWeightsBps[report.commitOrder], 0));
  const floors = raw.map((value) => Math.floor(value / 10_000));
  let remainder = 10_000 - floors.reduce((sum, value) => sum + value, 0);
  const priority = raw.map((value, index) => ({ index, fraction: value % 10_000 })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; remainder > 0; index = (index + 1) % priority.length, remainder--) floors[priority[index].index]++;
  return floors;
}

export function panelAggregateEvidenceHash(input: { taskId: string; workRound: number; checkpoint?: number; evidenceHashes: [Hex, Hex, Hex]; testers: [Hex, Hex, Hex]; passMask: number }) {
  return keccak256(encodeAbiParameters([
    { type: "uint256" }, { type: "uint32" }, { type: "uint8" }, { type: "bytes32[3]" }, { type: "address[3]" }, { type: "uint16" },
  ], [BigInt(input.taskId), input.workRound, input.checkpoint ?? 0, input.evidenceHashes, input.testers, input.passMask]));
}
