import { keccak256, recoverMessageAddress, stringToHex, type Hex } from "viem";
import { z } from "zod";
import { walletAddressSchema } from "./auth-schema";
import { assessTaskDefinition, collaborationPlanBlockers, verificationPlanBlockers, type TaskDefinition } from "./task-definition";

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
export const taskEvaluationSigningVersion = "AgentGrid Task Evaluation V2" as const;

export const signedTaskEvaluationSubmissionSchema = z.object({
  chainId: z.literal(97),
  taskRegistry: walletAddressSchema,
  report: taskEvaluationReportSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function taskEvaluationReportHash(raw: unknown) {
  const report = taskEvaluationReportSchema.parse(raw);
  return keccak256(stringToHex(JSON.stringify(canonical(report))));
}

export function taskEvaluationMessage(input: { chainId: 97; taskRegistry: string; taskId: string; report: TaskEvaluationReport }) {
  const taskRegistry = walletAddressSchema.parse(input.taskRegistry);
  const report = taskEvaluationReportSchema.parse(input.report);
  const reportHash = taskEvaluationReportHash(report);
  return {
    reportHash,
    message: `${taskEvaluationSigningVersion}\nChain ID: ${input.chainId}\nTaskRegistry: ${taskRegistry.toLowerCase()}\nTask: ${input.taskId}\nReport: ${reportHash}`,
  };
}

export async function verifyStoredTaskEvaluation(input: {
  taskId: string; evaluatorAddress: string; reportHash: string; report: unknown; signature: string;
  signingVersion: string | null; signingMessage: string | null; expectedTaskRegistry: string; allowLegacy?: boolean;
}) {
  try {
    const report = taskEvaluationReportSchema.parse(input.report);
    if (JSON.stringify(canonical(report)) !== JSON.stringify(canonical(input.report))) return false;
    const reportHash = taskEvaluationReportHash(report);
    if (reportHash.toLowerCase() !== input.reportHash.toLowerCase() || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) return false;
    let message: string;
    if (input.signingVersion === null && input.signingMessage === null) {
      if (!input.allowLegacy) return false;
      message = `AgentGrid Task Evaluation\nTask: ${input.taskId}\nReport: ${reportHash}`;
    } else {
      if (input.signingVersion !== taskEvaluationSigningVersion || !input.signingMessage) return false;
      const match = input.signingMessage.match(/^AgentGrid Task Evaluation V2\nChain ID: (97)\nTaskRegistry: (0x[0-9a-f]{40})\nTask: ([0-9]+)\nReport: (0x[0-9a-f]{64})$/);
      if (!match || match[2] !== input.expectedTaskRegistry.toLowerCase() || match[3] !== input.taskId || match[4] !== reportHash) return false;
      message = taskEvaluationMessage({ chainId: 97, taskRegistry: match[2], taskId: input.taskId, report }).message;
      if (message !== input.signingMessage) return false;
    }
    const signer = await recoverMessageAddress({ message, signature: input.signature as Hex });
    return signer.toLowerCase() === input.evaluatorAddress.toLowerCase();
  } catch { return false; }
}

export async function verifyTaskEvaluationSignature(input: { chainId: 97; taskRegistry: string; taskId: string; report: TaskEvaluationReport; signature: Hex; expectedAddress: string }) {
  const commitment = taskEvaluationMessage(input);
  const signer = await recoverMessageAddress({ message: commitment.message, signature: input.signature });
  if (signer.toLowerCase() !== input.expectedAddress.toLowerCase()) throw new Error("TASK_EVALUATION_SIGNATURE_INVALID");
  return { ...commitment, signer };
}

export function deterministicTaskEvaluation(spec: {
  title: string; description: string; category: string; maxExecutors: number; declaredDurationHours: number;
  executionMode?: "COLLABORATION" | "COMPETITION";
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
  const collaborationBlockers = spec.completionDefinition ? collaborationPlanBlockers(spec.completionDefinition, spec.executionMode ?? "COLLABORATION", spec.maxExecutors) : [];
  const verificationBlockers = spec.completionDefinition ? verificationPlanBlockers(spec.completionDefinition) : [];
  if (spec.description.length < 120) risks.push("The business description is short and may leave implementation assumptions unresolved.");
  if (testabilityBps < 5_000) risks.push("Acceptance criteria are not sufficiently machine-verifiable for independent validation.");
  risks.push(...definitionAssessment.blockers.map((item) => `Completion definition blocker: ${item}`));
  risks.push(...definitionAssessment.warnings.map((item) => `Completion definition warning: ${item}`));
  risks.push(...collaborationBlockers.map((item) => `Collaboration plan blocker: ${item}`));
  risks.push(...verificationBlockers.map((item) => `Verification panel blocker: ${item}`));
  reasons.push(`The committed completion definition scored ${definitionAssessment.score}/100 for independent verification readiness.`);
  const approve = spec.description.length >= 60 && spec.criteria.length >= 2 && testabilityBps >= 5_000 && definitionAssessment.ready && collaborationBlockers.length === 0 && verificationBlockers.length === 0;
  if (!approve) reasons.push("The task is rejected until its scope and independently testable acceptance criteria are strengthened.");
  return taskEvaluationReportSchema.parse({ category: spec.category, difficultyBps, estimatedHours, testabilityBps, recommendedReward, approve, reasons, risks });
}
