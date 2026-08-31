import { keccak256, recoverMessageAddress, stringToHex, type Hex } from "viem";
import { z } from "zod";
import { assessTaskDefinition, type TaskDefinition } from "./task-definition";

export const taskEvaluationReportSchema = z.object({
  category: z.string().trim().min(2).max(64),
  difficultyBps: z.number().int().min(1).max(10_000),
  estimatedHours: z.number().int().min(1).max(2_160),
  testabilityBps: z.number().int().min(0).max(10_000),
  recommendedReward: z.number().int().positive().max(1_000_000_000),
  approve: z.boolean(),
  reasons: z.array(z.string().trim().min(3).max(500)).min(1).max(12),
  risks: z.array(z.string().trim().min(3).max(500)).max(12),
}).strict();

export type TaskEvaluationReport = z.infer<typeof taskEvaluationReportSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function taskEvaluationMessage(input: { taskId: string; report: TaskEvaluationReport }) {
  const report = taskEvaluationReportSchema.parse(input.report);
  const reportHash = keccak256(stringToHex(JSON.stringify(canonical(report))));
  return { reportHash, message: `AgentGrid Task Evaluation\nTask: ${input.taskId}\nReport: ${reportHash}` };
}

export async function verifyTaskEvaluationSignature(input: { taskId: string; report: TaskEvaluationReport; signature: Hex; expectedAddress: string }) {
  const commitment = taskEvaluationMessage(input);
  const signer = await recoverMessageAddress({ message: commitment.message, signature: input.signature });
  if (signer.toLowerCase() !== input.expectedAddress.toLowerCase()) throw new Error("TASK_EVALUATION_SIGNATURE_INVALID");
  return { ...commitment, signer };
}

export function deterministicTaskEvaluation(spec: {
  title: string; description: string; category: string; maxExecutors: number; declaredDurationHours: number;
  criteria: string[]; requestedReward: number;
  completionDefinition?: TaskDefinition;
}): TaskEvaluationReport {
  const criteriaText = spec.criteria.join(" ").toLowerCase();
  const measurableTerms = ["test", "测试", "coverage", "覆盖", "build", "构建", "latency", "延迟", "%", "error", "错误"];
  const measurableHits = measurableTerms.filter((term) => criteriaText.includes(term)).length;
  const testabilityBps = Math.min(10_000, 3_000 + spec.criteria.length * 750 + measurableHits * 500);
  const estimatedHours = Math.max(1, Math.min(2_160, Math.round(spec.declaredDurationHours * (1 + Math.max(0, spec.maxExecutors - 1) * 0.08))));
  const difficultyBps = Math.max(500, Math.min(10_000, Math.round(1_500 + Math.log2(estimatedHours + 1) * 900 + spec.criteria.length * 180)));
  const modelReward = Math.max(1, Math.round(estimatedHours * (20 + difficultyBps / 500)));
  const recommendedReward = Math.max(1, Math.min(Math.round(spec.requestedReward), modelReward));
  const reasons = [
    `${spec.criteria.length} acceptance criteria were assessed; ${measurableHits} measurable quality signals were found.`,
    `The declared ${spec.declaredDurationHours}h duration and ${spec.maxExecutors}-agent team imply approximately ${estimatedHours} work hours.`,
    `Reward recommendation is capped by the publisher request and the deterministic effort model.`,
  ];
  const risks: string[] = [];
  const definitionAssessment = spec.completionDefinition ? assessTaskDefinition(spec.completionDefinition) : { ready: false, score: 0, blockers: ["COMPLETION_DEFINITION_MISSING"], warnings: [] };
  if (spec.description.length < 120) risks.push("The business description is short and may leave implementation assumptions unresolved.");
  if (testabilityBps < 5_000) risks.push("Acceptance criteria are not sufficiently machine-verifiable for independent validation.");
  risks.push(...definitionAssessment.blockers.map((item) => `Completion definition blocker: ${item}`));
  risks.push(...definitionAssessment.warnings.map((item) => `Completion definition warning: ${item}`));
  reasons.push(`The committed completion definition scored ${definitionAssessment.score}/100 for independent verification readiness.`);
  const approve = spec.description.length >= 60 && spec.criteria.length >= 2 && testabilityBps >= 5_000 && definitionAssessment.ready;
  if (!approve) reasons.push("The task is rejected until its scope and independently testable acceptance criteria are strengthened.");
  return taskEvaluationReportSchema.parse({ category: spec.category, difficultyBps, estimatedHours, testabilityBps, recommendedReward, approve, reasons, risks });
}
