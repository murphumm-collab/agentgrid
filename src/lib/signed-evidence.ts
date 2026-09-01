import { keccak256, recoverMessageAddress, stringToHex, type Hex } from "viem";
import { signedEvidenceSubmissionSchema, type SignedEvidenceSubmission } from "./test-evidence-schema";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function testEvidenceReportHash(raw: unknown) {
  const report = signedEvidenceSubmissionSchema.shape.report.parse(raw);
  return keccak256(stringToHex(JSON.stringify(canonical(report))));
}

type EvidenceMessageInput = Omit<SignedEvidenceSubmission, "testerAgentId" | "signature">;
export const testEvidenceSigningVersion = "AgentGrid Test Evidence V4" as const;

export function evidenceMessage(raw: EvidenceMessageInput) {
  const input = signedEvidenceSubmissionSchema.omit({ testerAgentId: true, signature: true }).parse(raw);
  const reportHash = testEvidenceReportHash(input.report);
  const executorOrderHash = keccak256(stringToHex(JSON.stringify(input.executorOrder.map((address) => address.toLowerCase()))));
  return {
    reportHash,
    executorOrderHash,
    message: [
      testEvidenceSigningVersion,
      `Chain ID: ${input.chainId}`,
      `TaskRegistry: ${input.taskRegistry.toLowerCase()}`,
      `Task: ${input.taskId}`,
      `Work round: ${input.workRound}`,
      `Checkpoint: ${input.checkpoint}`,
      `Panel epoch: ${input.panelEpoch}`,
      `Verification shard: ${input.verificationShard}`,
      `Execution mode: ${input.executionMode}`,
      `Artifact: ${input.artifactHash}`,
      `Executor order: ${executorOrderHash}`,
      `Report: ${reportHash}`,
    ].join("\n"),
  };
}

export async function verifyStoredTestEvidence(input: {
  taskId: string; testerAddress: string; artifactHash: string; reportHash: string; report: unknown; signature: string;
  signingVersion: string | null; signingMessage: string | null; expectedTaskRegistry: string;
  expectedWorkRound: number; expectedExecutionMode: "COLLABORATION" | "COMPETITION"; expectedExecutorOrder: string[];
  expectedCheckpoint: number; expectedPanelEpoch: number; expectedVerificationShard: number;
  allowLegacy?: boolean;
}) {
  try {
    const report = signedEvidenceSubmissionSchema.shape.report.parse(input.report);
    if (JSON.stringify(canonical(report)) !== JSON.stringify(canonical(input.report))) return false;
    const reportHash = testEvidenceReportHash(input.report);
    if (reportHash.toLowerCase() !== input.reportHash.toLowerCase() || !/^0x[0-9a-fA-F]{130}$/.test(input.signature)) return false;
    let message: string;
    if (input.signingVersion === null && input.signingMessage === null) {
      if (!input.allowLegacy) return false;
      message = `AgentGrid Test Evidence\nTask: ${input.taskId}\nArtifact: ${input.artifactHash}\nReport: ${reportHash}`;
    } else {
      if (input.signingVersion !== testEvidenceSigningVersion || !input.signingMessage) return false;
      const match = input.signingMessage.match(/^AgentGrid Test Evidence V4\nChain ID: (97)\nTaskRegistry: (0x[0-9a-f]{40})\nTask: ([0-9]+)\nWork round: ([1-9][0-9]*)\nCheckpoint: ([0-3])\nPanel epoch: ([1-9][0-9]*)\nVerification shard: ([0-2])\nExecution mode: (COLLABORATION|COMPETITION)\nArtifact: (sha256:[0-9a-f]{64})\nExecutor order: (0x[0-9a-f]{64})\nReport: (0x[0-9a-f]{64})$/);
      const executorOrder = signedEvidenceSubmissionSchema.shape.executorOrder.parse(input.expectedExecutorOrder);
      const executorOrderHash = keccak256(stringToHex(JSON.stringify(executorOrder.map((address) => address.toLowerCase()))));
      if (!match || match[2] !== input.expectedTaskRegistry.toLowerCase() || match[3] !== input.taskId
        || match[4] !== String(input.expectedWorkRound) || match[5] !== String(input.expectedCheckpoint)
        || match[6] !== String(input.expectedPanelEpoch) || match[7] !== String(input.expectedVerificationShard) || match[8] !== input.expectedExecutionMode
        || match[9] !== input.artifactHash || match[10] !== executorOrderHash || match[11] !== reportHash) return false;
      if ((input.expectedExecutionMode === "COMPETITION") !== Boolean(report.competition)) return false;
      message = input.signingMessage;
    }
    const signer = await recoverMessageAddress({ message, signature: input.signature as Hex });
    return signer.toLowerCase() === input.testerAddress.toLowerCase();
  } catch { return false; }
}

export async function verifyEvidenceSignature(input: EvidenceMessageInput & { signature: Hex; expectedAddress: string }) {
  const { signature, expectedAddress, ...messageInput } = input;
  const commitment = evidenceMessage(messageInput);
  const signer = await recoverMessageAddress({ message: commitment.message, signature });
  if (signer.toLowerCase() !== expectedAddress.toLowerCase()) throw new Error("TEST_EVIDENCE_SIGNATURE_INVALID");
  return { ...commitment, signer };
}

export function storedEvidenceHash(input: { reportHash: string; testerAddress: string; signature: string }) {
  return keccak256(stringToHex(JSON.stringify({
    reportHash: input.reportHash,
    signer: input.testerAddress.toLowerCase(),
    signature: input.signature.toLowerCase(),
  })));
}
