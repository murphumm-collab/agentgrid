import { keccak256, recoverMessageAddress, stringToHex, type Hex } from "viem";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function evidenceMessage(input: { taskId: string; artifactHash: string; report: unknown }) {
  const reportJson = JSON.stringify(canonical(input.report));
  const reportHash = keccak256(stringToHex(reportJson));
  return { reportHash, message: `AgentGrid Test Evidence\nTask: ${input.taskId}\nArtifact: ${input.artifactHash}\nReport: ${reportHash}` };
}

export async function verifyEvidenceSignature(input: { taskId: string; artifactHash: string; report: unknown; signature: Hex; expectedAddress: string }) {
  const commitment = evidenceMessage(input);
  const signer = await recoverMessageAddress({ message: commitment.message, signature: input.signature });
  if (signer.toLowerCase() !== input.expectedAddress.toLowerCase()) throw new Error("TEST_EVIDENCE_SIGNATURE_INVALID");
  return { ...commitment, signer };
}
