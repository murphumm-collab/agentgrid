import { describe, expect, it } from "vitest";
import {
  applicationQaBindingBlockers, applicationQaCommandEnvironment, requiredApplicationQaCommands,
  validateApplicationQaRuntimeEnvironment, verifyApplicationQaReport,
} from "./application-qa-evidence";

const start = Date.parse("2026-08-31T00:00:00.000Z");

function fixture() {
  return {
    version: 1,
    scope: "agentgrid-production-application-qa",
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(start + 30_000).toISOString(),
    sourceSha256: `sha256:${"1".repeat(64)}`,
    environment: { node: "v22.1.0", packageManager: "pnpm 10.0.0", platform: "darwin", arch: "arm64" },
    candidate: {
      buildId: "candidate-build-id", createdAt: new Date(start + 29_000).toISOString(),
      serverSha256: "2".repeat(64), payloadSha256: `sha256:${"6".repeat(64)}`,
      payloadEntries: 42, payloadBytes: 10_000, releaseManifestSha256: `sha256:${"3".repeat(64)}`,
    },
    commands: requiredApplicationQaCommands.map((command, index) => ({
      id: command.id, executable: "pnpm", args: [...command.args], environmentProfile: command.environmentProfile,
      startedAt: new Date(start + index * 1_000).toISOString(),
      completedAt: new Date(start + index * 1_000 + 500).toISOString(), durationMs: 500, exitCode: 0,
      stdoutSha256: `sha256:${"4".repeat(64)}`, stderrSha256: `sha256:${"5".repeat(64)}`,
    })),
  };
}

describe("application QA evidence", () => {
  it("fails fast unless production QA dependencies and an isolated reorg Redis are explicit", () => {
    const environment = {
      PROTOCOL_MODE: "production",
      DATABASE_URL: "postgresql://agentgrid:secret@127.0.0.1:5432/agentgrid",
      REDIS_URL: "redis://127.0.0.1:6379/13",
      REORG_SMOKE_DATABASE_URL: "postgresql://agentgrid:secret@127.0.0.1:5432/agentgrid",
      REORG_SMOKE_REDIS_URL: "redis://127.0.0.1:6379/14",
      AUTH_SECRET: "a".repeat(32),
      AUTH_ORIGIN: "http://127.0.0.1:3000",
      ARTIFACT_MASTER_KEY: "b".repeat(64),
      BACKUP_DIRECTORY: "/tmp/agentgrid-qa-backups",
    };
    expect(() => validateApplicationQaRuntimeEnvironment(environment, "/workspace/agentgrid", "linux")).not.toThrow();
    expect(() => validateApplicationQaRuntimeEnvironment({ ...environment, REORG_SMOKE_REDIS_URL: environment.REDIS_URL }, "/workspace/agentgrid", "linux"))
      .toThrow("APPLICATION_QA_REORG_REDIS_MUST_BE_ISOLATED");
    expect(() => validateApplicationQaRuntimeEnvironment({ ...environment, REORG_SMOKE_DATABASE_URL: "" }, "/workspace/agentgrid", "linux"))
      .toThrow("APPLICATION_QA_REORG_SMOKE_DATABASE_URL_REQUIRED");
    expect(() => validateApplicationQaRuntimeEnvironment({ ...environment, BACKUP_DIRECTORY: "/workspace/agentgrid/.backups" }, "/workspace/agentgrid", "linux"))
      .toThrow("APPLICATION_QA_BACKUP_DIRECTORY_MUST_BE_OUTSIDE_WORKSPACE");
    expect(() => validateApplicationQaRuntimeEnvironment({ ...environment, AUTH_ORIGIN: "https://agentgrid.example/app" }, "/workspace/agentgrid", "linux"))
      .toThrow("APPLICATION_QA_AUTH_ORIGIN_INVALID");
    expect(() => validateApplicationQaRuntimeEnvironment({ ...environment, AUTH_ORIGIN: "not-a-url" }, "/workspace/agentgrid", "linux"))
      .toThrow("APPLICATION_QA_AUTH_ORIGIN_INVALID");
    expect(() => validateApplicationQaRuntimeEnvironment(environment, "/workspace/agentgrid", "darwin"))
      .toThrow("APPLICATION_QA_SANDBOX_TEMP_DIRECTORY_REQUIRED_ON_DARWIN");
  });

  it("inherits the QA database for the file-secret smoke without leaking direct secrets", () => {
    const environment = {
      DATABASE_URL: "postgresql://agentgrid:secret@127.0.0.1:55433/agentgrid",
      AUTH_SECRET: "a".repeat(32),
      S3_SECRET_KEY: "storage-secret",
    };
    const isolated = applicationQaCommandEnvironment(environment, "file-secret-isolation");
    expect(isolated.SECRET_SMOKE_DATABASE_URL).toBe(environment.DATABASE_URL);
    expect(isolated.DATABASE_URL).toBeUndefined();
    expect(isolated.AUTH_SECRET).toBeUndefined();
    expect(isolated.S3_SECRET_KEY).toBeUndefined();
    expect(isolated.PROTOCOL_MODE).toBe("production");
  });

  it("removes every direct and file-backed runtime secret from isolated unit commands", () => {
    const environment = {
      TRUSTED_PROXY_SHARED_SECRET: "proxy-secret-that-must-not-reach-tests",
      TRUSTED_PROXY_SHARED_SECRET_FILE: "/run/secrets/proxy",
      SPEC_ASSISTANT_AI_API_KEY: "ai-secret-that-must-not-reach-tests",
      SPEC_ASSISTANT_AI_API_KEY_FILE: "/run/secrets/ai",
      REDIS_URL: "redis://production.internal:6379",
    };
    const isolated = applicationQaCommandEnvironment(environment, "demo-test-isolation");
    for (const name of Object.keys(environment)) expect(isolated[name]).toBeUndefined();
  });

  it("accepts the exact ordered production QA command set", () => {
    expect(verifyApplicationQaReport(fixture(), new Date(start + 60_000)).commands).toHaveLength(requiredApplicationQaCommands.length);
  });

  it("rejects missing, reordered, substituted and failed commands", () => {
    const missing = fixture();
    missing.commands.pop();
    expect(() => verifyApplicationQaReport(missing, new Date(start + 60_000))).toThrow("APPLICATION_QA_COMMAND_SET_INCOMPLETE");
    const reordered = fixture();
    [reordered.commands[0], reordered.commands[1]] = [reordered.commands[1]!, reordered.commands[0]!];
    expect(() => verifyApplicationQaReport(reordered, new Date(start + 60_000))).toThrow("APPLICATION_QA_COMMAND_MISMATCH_UNIT_TESTS_AND_DEPENDENCY_AUDIT");
    const substituted = fixture();
    substituted.commands[0]!.args = ["test:watch"];
    expect(() => verifyApplicationQaReport(substituted, new Date(start + 60_000))).toThrow("APPLICATION_QA_COMMAND_MISMATCH_UNIT_TESTS_AND_DEPENDENCY_AUDIT");
    const wrongEnvironment = fixture();
    wrongEnvironment.commands[0]!.environmentProfile = "qa-production-runtime";
    expect(() => verifyApplicationQaReport(wrongEnvironment, new Date(start + 60_000))).toThrow("APPLICATION_QA_COMMAND_MISMATCH_UNIT_TESTS_AND_DEPENDENCY_AUDIT");
    const failed = fixture() as ReturnType<typeof fixture> & { commands: Array<Record<string, unknown>> };
    failed.commands[0]!.exitCode = 1;
    expect(() => verifyApplicationQaReport(failed, new Date(start + 60_000))).toThrow();
  });

  it("rejects inconsistent timestamps and source/candidate zero hashes", () => {
    const invalidDuration = fixture();
    invalidDuration.commands[0]!.durationMs = 499;
    expect(() => verifyApplicationQaReport(invalidDuration, new Date(start + 60_000))).toThrow("APPLICATION_QA_COMMAND_DURATION_INVALID");
    const lateCandidate = fixture();
    lateCandidate.candidate.createdAt = new Date(start + 31_000).toISOString();
    expect(() => verifyApplicationQaReport(lateCandidate, new Date(start + 60_000))).toThrow("APPLICATION_QA_CANDIDATE_TIME_INVALID");
    const zeroSource = fixture();
    zeroSource.sourceSha256 = `sha256:${"0".repeat(64)}`;
    expect(() => verifyApplicationQaReport(zeroSource, new Date(start + 60_000))).toThrow();
  });

  it("binds the QA run to the exact candidate manifest and later release", () => {
    const report = verifyApplicationQaReport(fixture(), new Date(start + 60_000));
    const valid = {
      report,
      candidate: {
        buildId: report.candidate.buildId, createdAt: report.candidate.createdAt,
        serverSha256: report.candidate.serverSha256, payloadSha256: report.candidate.payloadSha256,
        payloadEntries: report.candidate.payloadEntries, payloadBytes: report.candidate.payloadBytes,
      },
      candidateReleaseManifestSha256: report.candidate.releaseManifestSha256,
      releaseCreatedAt: new Date(start + 40_000).toISOString(),
    };
    expect(applicationQaBindingBlockers(valid)).toEqual([]);
    expect(applicationQaBindingBlockers({
      ...valid,
      candidate: {
        ...valid.candidate, buildId: "substituted-build", serverSha256: "9".repeat(64),
        payloadSha256: `sha256:${"7".repeat(64)}`,
      },
      candidateReleaseManifestSha256: `sha256:${"8".repeat(64)}`,
      releaseCreatedAt: new Date(start + 20_000).toISOString(),
    })).toEqual(expect.arrayContaining([
      "PRODUCTION_RELEASE_QA_CANDIDATE_BUILD_MISMATCH",
      "PRODUCTION_RELEASE_QA_CANDIDATE_SERVER_MISMATCH",
      "PRODUCTION_RELEASE_QA_CANDIDATE_PAYLOAD_MISMATCH",
      "PRODUCTION_RELEASE_QA_CANDIDATE_MANIFEST_MISMATCH",
      "PRODUCTION_RELEASE_PREDATES_APPLICATION_QA",
    ]));
  });
});
