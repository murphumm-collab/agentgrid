import { getAddress, keccak256, recoverMessageAddress, stringToHex, type Hex } from "viem";
import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const businessWorkflowTypes = [
  "PRODUCTION_DEPLOYED",
  "INTERNAL_WORKFLOW",
  "CUSTOMER_DELIVERED",
  "RESEARCH_DECISION",
] as const;

export const businessAdoptionReportSchema = z.object({
  version: z.literal(1),
  chainId: z.number().int().positive(),
  taskId: z.string().regex(/^\d+$/),
  publisher: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  releaseId: z.string().uuid(),
  artifactHash: sha256Schema,
  releasedAt: z.string().datetime({ offset: true }),
  workflowType: z.enum(businessWorkflowTypes),
  workflowEvidenceHash: sha256Schema,
  adoptedAt: z.string().datetime({ offset: true }),
}).strict();

export type BusinessAdoptionReport = z.infer<typeof businessAdoptionReportSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function businessAdoptionMessage(rawReport: BusinessAdoptionReport) {
  const report = businessAdoptionReportSchema.parse(rawReport);
  const reportHash = keccak256(stringToHex(JSON.stringify(canonical(report))));
  return {
    report,
    reportHash,
    message: `AgentGrid Business Adoption\nVersion: 1\nChain ID: ${report.chainId}\nTask: ${report.taskId}\nArtifact: ${report.artifactHash}\nReport: ${reportHash}`,
  };
}

export async function verifyBusinessAdoptionSignature(input: {
  report: BusinessAdoptionReport;
  signature: Hex;
  expectedAddress: string;
}) {
  const commitment = businessAdoptionMessage(input.report);
  const signer = await recoverMessageAddress({ message: commitment.message, signature: input.signature });
  if (signer.toLowerCase() !== getAddress(input.expectedAddress).toLowerCase()) {
    throw new Error("BUSINESS_ADOPTION_SIGNATURE_INVALID");
  }
  return { ...commitment, signer };
}

export interface BusinessAdoptionTask {
  id: string;
  publisher: string;
  state: string;
  submission?: { artifactHash: string } | null;
}

export interface ArtifactReleaseProof {
  id: string;
  taskId: string;
  publisher: string;
  artifactHash: string;
  createdAt: string;
}

export function assertBusinessAdoptionEligibility(input: {
  report: BusinessAdoptionReport;
  task: BusinessAdoptionTask | undefined;
  release: ArtifactReleaseProof | undefined;
  sessionAddress: string;
  expectedChainId: number;
  now?: Date;
}) {
  const report = businessAdoptionReportSchema.parse(input.report);
  const { task, release } = input;
  if (!task || task.publisher.toLowerCase() !== input.sessionAddress.toLowerCase()) {
    throw new Error("BUSINESS_ADOPTION_PUBLISHER_DENIED");
  }
  if (!release) throw new Error("ARTIFACT_RELEASE_REQUIRED");
  if (!task.submission || !["MAINTENANCE", "COMPLETED"].includes(task.state)) {
    throw new Error("BUSINESS_ADOPTION_REQUIRES_ACCEPTED_TASK");
  }
  if (report.chainId !== input.expectedChainId) throw new Error("BUSINESS_ADOPTION_CHAIN_MISMATCH");
  if (report.taskId !== task.id || release.taskId !== task.id) throw new Error("BUSINESS_ADOPTION_TASK_MISMATCH");
  if (report.publisher.toLowerCase() !== task.publisher.toLowerCase()
    || release.publisher.toLowerCase() !== task.publisher.toLowerCase()) {
    throw new Error("BUSINESS_ADOPTION_PUBLISHER_MISMATCH");
  }
  if (report.releaseId !== release.id) throw new Error("BUSINESS_ADOPTION_RELEASE_MISMATCH");
  if (report.artifactHash !== release.artifactHash) throw new Error("BUSINESS_ADOPTION_ARTIFACT_MISMATCH");
  const chainArtifactHash = keccak256(stringToHex(report.artifactHash));
  if (chainArtifactHash.toLowerCase() !== task.submission.artifactHash.toLowerCase()) {
    throw new Error("BUSINESS_ADOPTION_CHAIN_ARTIFACT_MISMATCH");
  }
  const releasedAt = new Date(release.createdAt);
  const reportedReleaseAt = new Date(report.releasedAt);
  const adoptedAt = new Date(report.adoptedAt);
  const now = input.now ?? new Date();
  if (releasedAt.getTime() !== reportedReleaseAt.getTime()) throw new Error("BUSINESS_ADOPTION_RELEASE_TIME_MISMATCH");
  if (adoptedAt.getTime() < releasedAt.getTime()) throw new Error("BUSINESS_ADOPTION_BEFORE_RELEASE");
  if (adoptedAt.getTime() > now.getTime() + 5 * 60 * 1_000) throw new Error("BUSINESS_ADOPTION_TIME_IN_FUTURE");
  return { report, chainArtifactHash };
}
