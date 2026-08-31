import path from "node:path";
import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/).refine((value) => !/^sha256:0{64}$/.test(value));

export const requiredApplicationQaCommands = [
  { id: "unit-tests", args: ["test"], environmentProfile: "demo-test-isolation" },
  { id: "typecheck", args: ["exec", "tsc", "--noEmit"], environmentProfile: "qa-production-runtime" },
  { id: "lint", args: ["lint"], environmentProfile: "qa-production-runtime" },
  { id: "contracts-compile", args: ["contracts:compile"], environmentProfile: "qa-production-runtime" },
  { id: "contracts-regression", args: ["contracts:test"], environmentProfile: "qa-production-runtime" },
  { id: "workers-build", args: ["workers:build"], environmentProfile: "qa-production-runtime" },
  { id: "production-compose", args: ["production:config"], environmentProfile: "qa-production-runtime" },
  { id: "application-build", args: ["build"], environmentProfile: "qa-production-runtime" },
  { id: "file-secret-smoke", args: ["production:secrets:smoke"], environmentProfile: "file-secret-isolation" },
  { id: "postgres-session-smoke", args: ["production:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "queue-lease-smoke", args: ["queue:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "artifact-integrity-smoke", args: ["artifact:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "tester-sandbox-smoke", args: ["sandbox:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "artifact-key-rotation-smoke", args: ["ops:artifact-key:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "reorg-queue-smoke", args: ["reorg:queue:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "agent-delivery-smoke", args: ["agent:delivery:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "monitoring-alert-drill-smoke", args: ["ops:monitor:drill:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "trusted-proxy-smoke", args: ["ops:proxy:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "kms-custody-smoke", args: ["ops:kms:smoke"], environmentProfile: "qa-production-runtime" },
  { id: "database-backup", args: ["ops:backup"], environmentProfile: "qa-production-runtime" },
  { id: "database-restore", args: ["ops:backup:verify"], environmentProfile: "qa-production-runtime" },
  { id: "candidate-snapshot", args: ["release:local:snapshot"], environmentProfile: "qa-production-runtime" },
] as const;

const commandResultSchema = z.object({
  id: z.string().min(1),
  executable: z.literal("pnpm"),
  args: z.array(z.string()).min(1),
  environmentProfile: z.enum(["demo-test-isolation", "file-secret-isolation", "qa-production-runtime"]),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.literal(0),
  stdoutSha256: sha256Schema,
  stderrSha256: sha256Schema,
}).strict();

export const applicationQaReportSchema = z.object({
  version: z.literal(1),
  scope: z.literal("agentgrid-production-application-qa"),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  sourceSha256: sha256Schema,
  environment: z.object({
    node: z.string().min(1),
    packageManager: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
  }).strict(),
  candidate: z.object({
    buildId: z.string().min(8).max(128),
    createdAt: z.string().datetime({ offset: true }),
    serverSha256: z.string().regex(/^[0-9a-f]{64}$/),
    payloadSha256: sha256Schema,
    payloadEntries: z.number().int().positive(),
    payloadBytes: z.number().int().positive(),
    releaseManifestSha256: sha256Schema,
  }).strict(),
  commands: z.array(commandResultSchema),
}).strict();

export type ApplicationQaReport = z.infer<typeof applicationQaReportSchema>;

export function validateApplicationQaRuntimeEnvironment(environment: NodeJS.ProcessEnv, workspace: string) {
  if (environment.PROTOCOL_MODE !== "production") throw new Error("APPLICATION_QA_PRODUCTION_MODE_REQUIRED");
  const required = [
    "DATABASE_URL", "REDIS_URL", "REORG_SMOKE_DATABASE_URL", "REORG_SMOKE_REDIS_URL",
    "AUTH_SECRET", "ARTIFACT_MASTER_KEY", "BACKUP_DIRECTORY",
  ] as const;
  for (const name of required) {
    if (!environment[name]?.trim()) throw new Error(`APPLICATION_QA_${name}_REQUIRED`);
  }
  const database = new URL(environment.DATABASE_URL!);
  const reorgDatabase = new URL(environment.REORG_SMOKE_DATABASE_URL!);
  if (!["postgres:", "postgresql:"].includes(database.protocol)
    || !["postgres:", "postgresql:"].includes(reorgDatabase.protocol)) throw new Error("APPLICATION_QA_DATABASE_URL_INVALID");
  const redis = new URL(environment.REDIS_URL!);
  const reorgRedis = new URL(environment.REORG_SMOKE_REDIS_URL!);
  if (!["redis:", "rediss:"].includes(redis.protocol) || !["redis:", "rediss:"].includes(reorgRedis.protocol)) {
    throw new Error("APPLICATION_QA_REDIS_URL_INVALID");
  }
  if (redis.href === reorgRedis.href) throw new Error("APPLICATION_QA_REORG_REDIS_MUST_BE_ISOLATED");
  if (environment.AUTH_SECRET!.length < 32) throw new Error("APPLICATION_QA_AUTH_SECRET_INVALID");
  if (!/^[0-9a-fA-F]{64}$/.test(environment.ARTIFACT_MASTER_KEY!)) throw new Error("APPLICATION_QA_ARTIFACT_MASTER_KEY_INVALID");
  const backupDirectory = path.resolve(environment.BACKUP_DIRECTORY!);
  const source = `${path.resolve(workspace)}${path.sep}`;
  if (backupDirectory === path.resolve(workspace) || backupDirectory.startsWith(source)) {
    throw new Error("APPLICATION_QA_BACKUP_DIRECTORY_MUST_BE_OUTSIDE_WORKSPACE");
  }
}

export function verifyApplicationQaReport(raw: unknown, now = new Date()) {
  const report = applicationQaReportSchema.parse(raw);
  const start = new Date(report.startedAt).getTime();
  const end = new Date(report.completedAt).getTime();
  if (end < start) throw new Error("APPLICATION_QA_TIME_RANGE_INVALID");
  if (end > now.getTime() + 5 * 60_000) throw new Error("APPLICATION_QA_TIME_IN_FUTURE");
  if (report.commands.length !== requiredApplicationQaCommands.length) throw new Error("APPLICATION_QA_COMMAND_SET_INCOMPLETE");
  for (let index = 0; index < requiredApplicationQaCommands.length; index += 1) {
    const expected = requiredApplicationQaCommands[index];
    const actual = report.commands[index]!;
    if (actual.id !== expected.id || actual.environmentProfile !== expected.environmentProfile
      || JSON.stringify(actual.args) !== JSON.stringify(expected.args)) {
      throw new Error(`APPLICATION_QA_COMMAND_MISMATCH_${expected.id.toUpperCase().replaceAll("-", "_")}`);
    }
    const commandStart = new Date(actual.startedAt).getTime();
    const commandEnd = new Date(actual.completedAt).getTime();
    if (commandStart < start || commandEnd < commandStart || commandEnd > end) throw new Error("APPLICATION_QA_COMMAND_TIME_INVALID");
    if (actual.durationMs !== commandEnd - commandStart) throw new Error("APPLICATION_QA_COMMAND_DURATION_INVALID");
  }
  const candidateCreated = new Date(report.candidate.createdAt).getTime();
  if (candidateCreated < start || candidateCreated > end) throw new Error("APPLICATION_QA_CANDIDATE_TIME_INVALID");
  return report;
}

export function applicationQaBindingBlockers(input: {
  report: ApplicationQaReport;
  candidate: {
    buildId: string; createdAt: string; serverSha256: string;
    payloadSha256: string; payloadEntries: number; payloadBytes: number;
  };
  candidateReleaseManifestSha256: string;
  releaseCreatedAt: string;
}) {
  const blockers: string[] = [];
  if (input.report.candidate.buildId !== input.candidate.buildId) blockers.push("PRODUCTION_RELEASE_QA_CANDIDATE_BUILD_MISMATCH");
  if (input.report.candidate.serverSha256 !== input.candidate.serverSha256) blockers.push("PRODUCTION_RELEASE_QA_CANDIDATE_SERVER_MISMATCH");
  if (input.report.candidate.payloadSha256 !== input.candidate.payloadSha256
    || input.report.candidate.payloadEntries !== input.candidate.payloadEntries
    || input.report.candidate.payloadBytes !== input.candidate.payloadBytes) blockers.push("PRODUCTION_RELEASE_QA_CANDIDATE_PAYLOAD_MISMATCH");
  if (input.report.candidate.releaseManifestSha256 !== input.candidateReleaseManifestSha256) blockers.push("PRODUCTION_RELEASE_QA_CANDIDATE_MANIFEST_MISMATCH");
  if (new Date(input.report.candidate.createdAt).getTime() !== new Date(input.candidate.createdAt).getTime()) blockers.push("PRODUCTION_RELEASE_QA_CANDIDATE_TIME_MISMATCH");
  if (new Date(input.report.completedAt).getTime() > new Date(input.releaseCreatedAt).getTime()) blockers.push("PRODUCTION_RELEASE_PREDATES_APPLICATION_QA");
  return blockers;
}
