import { keccak256, stringToHex } from "viem";

export interface ArtifactReleaseTask {
  publisher: string;
  state: string;
  submission?: { artifactHash: string } | null;
}

export interface TeamArtifactTask {
  executionMode: "COLLABORATION" | "COMPETITION";
  executorIds: string[];
  testerId?: string | null;
  testerIds?: string[];
  teamClosed?: boolean;
  state: string;
}

export interface EncryptedArtifactRecord {
  plaintextSha256: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  encryptionAlgorithm: string;
  contentIv: string;
}

export function encryptedArtifactAccess(
  artifact: EncryptedArtifactRecord,
  capability: { decryptionKey: string; downloadUrl: string; expiresInSeconds?: number },
) {
  if (!/^[0-9a-f]{64}$/i.test(artifact.plaintextSha256) || !/^[0-9a-f]{64}$/i.test(artifact.sha256)) throw new Error("ARTIFACT_HASH_INVALID");
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 16 || artifact.sizeBytes > 100 * 1024 * 1024) throw new Error("ARTIFACT_SIZE_LIMIT_EXCEEDED");
  if (artifact.contentType !== "application/gzip" || artifact.encryptionAlgorithm !== "AES-256-GCM") throw new Error("ARTIFACT_ENCRYPTION_METADATA_INVALID");
  return {
    artifactHash: `sha256:${artifact.plaintextSha256}`,
    ciphertextHash: `sha256:${artifact.sha256}`,
    sizeBytes: artifact.sizeBytes,
    contentType: artifact.contentType,
    encryptionAlgorithm: artifact.encryptionAlgorithm,
    contentIv: artifact.contentIv,
    decryptionKey: capability.decryptionKey,
    downloadUrl: capability.downloadUrl,
    expiresInSeconds: capability.expiresInSeconds ?? 300,
  };
}

export function assertTeamArtifactAccess(input: { task: TeamArtifactTask | undefined; owner: string }) {
  const { task } = input;
  if (!task) throw new Error("TEAM_ARTIFACT_ACCESS_DENIED");
  const owner = input.owner.toLowerCase();
  const executorIndex = task.executorIds.findIndex((executor) => executor.toLowerCase() === owner);
  const isTester = (task.testerIds?.length ? task.testerIds : task.testerId ? [task.testerId] : []).some((tester) => tester.toLowerCase() === owner);
  if (executorIndex < 0 && !isTester) throw new Error("TEAM_ARTIFACT_ACCESS_DENIED");
  if (task.executionMode === "COMPETITION" && !isTester) throw new Error("COMPETITION_CANDIDATE_ISOLATION_ENFORCED");
  if (task.executionMode === "COLLABORATION" && executorIndex > 0) throw new Error("TEAM_ASSEMBLY_LEAD_ONLY");
  if (!task.teamClosed || !["CLAIMED", "SUBMITTED", "TESTING"].includes(task.state)) throw new Error("TEAM_CONTRIBUTIONS_NOT_AVAILABLE");
  if (task.executionMode === "COMPETITION" && task.state !== "TESTING") throw new Error("COMPETITION_CANDIDATES_NOT_READY");
  return { isTester: Boolean(isTester), isExecutor: executorIndex >= 0 };
}

/**
 * This is the final confidentiality gate for executor deliverables. The
 * publisher may inspect commitments and test evidence before acceptance, but
 * never receives a download capability or decryption key until the accepted
 * state is confirmed by the chain projection.
 */
export function assertPublisherArtifactRelease(input: {
  task: ArtifactReleaseTask | undefined;
  sessionAddress: string;
  plaintextSha256?: string;
}) {
  const { task } = input;
  if (!task || task.publisher.toLowerCase() !== input.sessionAddress.toLowerCase()) {
    throw new Error("PUBLISHER_ARTIFACT_ACCESS_DENIED");
  }
  if (task.state !== "MAINTENANCE" && task.state !== "COMPLETED") {
    throw new Error("ARTIFACT_LOCKED_UNTIL_ACCEPTANCE");
  }
  if (!input.plaintextSha256) return;
  const committedArtifact = keccak256(stringToHex(`sha256:${input.plaintextSha256}`));
  if (!task.submission || task.submission.artifactHash.toLowerCase() !== committedArtifact.toLowerCase()) {
    throw new Error("ARTIFACT_CHAIN_COMMITMENT_MISMATCH");
  }
  return { committedArtifact };
}
