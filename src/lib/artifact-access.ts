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
  teamClosed?: boolean;
  state: string;
}

export function assertTeamArtifactAccess(input: { task: TeamArtifactTask | undefined; owner: string }) {
  const { task } = input;
  if (!task) throw new Error("TEAM_ARTIFACT_ACCESS_DENIED");
  const owner = input.owner.toLowerCase();
  const executorIndex = task.executorIds.findIndex((executor) => executor.toLowerCase() === owner);
  const isTester = task.testerId?.toLowerCase() === owner;
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
