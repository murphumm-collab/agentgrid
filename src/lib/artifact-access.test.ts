import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { assertPublisherArtifactRelease, assertTeamArtifactAccess } from "./artifact-access";

const publisher = "0x1111111111111111111111111111111111111111";
const sha256 = "a".repeat(64);
const artifactHash = keccak256(stringToHex(`sha256:${sha256}`));

function task(state: string, overrides: Record<string, unknown> = {}) {
  return { publisher, state, submission: { artifactHash }, ...overrides };
}

describe("publisher artifact release policy", () => {
  it.each(["OPEN", "CLAIMED", "SUBMITTED", "TESTING", "CORRECTION", "USER_REVIEW", "REJECTED"])(
    "keeps the deliverable encrypted while the task is %s",
    (state) => {
      expect(() => assertPublisherArtifactRelease({ task: task(state), sessionAddress: publisher, plaintextSha256: sha256 }))
        .toThrow("ARTIFACT_LOCKED_UNTIL_ACCEPTANCE");
    },
  );

  it.each(["MAINTENANCE", "COMPLETED"])("releases only after accepted chain state %s", (state) => {
    expect(assertPublisherArtifactRelease({ task: task(state), sessionAddress: publisher, plaintextSha256: sha256 }))
      .toEqual({ committedArtifact: artifactHash });
  });

  it("rejects another wallet even after acceptance", () => {
    expect(() => assertPublisherArtifactRelease({
      task: task("MAINTENANCE"), sessionAddress: "0x2222222222222222222222222222222222222222", plaintextSha256: sha256,
    })).toThrow("PUBLISHER_ARTIFACT_ACCESS_DENIED");
  });

  it("rejects substitution between the sealed object and chain commitment", () => {
    expect(() => assertPublisherArtifactRelease({ task: task("MAINTENANCE"), sessionAddress: publisher, plaintextSha256: "b".repeat(64) }))
      .toThrow("ARTIFACT_CHAIN_COMMITMENT_MISMATCH");
  });
});

describe("team candidate access policy", () => {
  const lead = "0x1000000000000000000000000000000000000001";
  const member = "0x1000000000000000000000000000000000000002";
  const tester = "0x1000000000000000000000000000000000000003";

  it("allows only the collaboration lead and assigned tester to read team contributions", () => {
    const collaboration = { executionMode: "COLLABORATION" as const, executorIds: [lead, member], testerId: tester, teamClosed: true, state: "TESTING" };
    expect(assertTeamArtifactAccess({ task: collaboration, owner: lead }).isExecutor).toBe(true);
    expect(assertTeamArtifactAccess({ task: collaboration, owner: tester }).isTester).toBe(true);
    expect(() => assertTeamArtifactAccess({ task: collaboration, owner: member })).toThrow("TEAM_ASSEMBLY_LEAD_ONLY");
  });

  it("keeps competition candidates hidden from every executor and opens them only to the assigned tester", () => {
    const competition = { executionMode: "COMPETITION" as const, executorIds: [lead, member], testerId: tester, teamClosed: true, state: "TESTING" };
    expect(() => assertTeamArtifactAccess({ task: competition, owner: lead })).toThrow("COMPETITION_CANDIDATE_ISOLATION_ENFORCED");
    expect(() => assertTeamArtifactAccess({ task: { ...competition, state: "SUBMITTED" }, owner: tester })).toThrow("COMPETITION_CANDIDATES_NOT_READY");
    expect(assertTeamArtifactAccess({ task: competition, owner: tester }).isTester).toBe(true);
  });
});
