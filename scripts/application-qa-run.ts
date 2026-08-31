import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs, { constants as fsConstants, promises as fsp } from "node:fs";
import path from "node:path";
import {
  applicationQaReportSchema, requiredApplicationQaCommands, validateApplicationQaRuntimeEnvironment, type ApplicationQaReport,
} from "../src/lib/application-qa-evidence";
import { candidateReleaseManifestSchema, verifyCandidatePayload } from "../src/lib/candidate-release";

const maximumOutputBytes = 16 * 1024 * 1024;
const sourceInputs = [
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "vitest.config.ts", "next-env.d.ts",
  "next.config.ts", "eslint.config.mjs", ".dockerignore", "Dockerfile", "docker-compose.yml",
  "docker-compose.production.yml", "src", "agents", "scripts", "contracts/src",
  "contracts/scripts", "contracts/test", "contracts/vitest.config.ts", "public",
] as const;

function sha256(bytes: Buffer | string) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function sourceTreeSha256(root: string) {
  const files: string[] = [];
  async function visit(relative: string) {
    const absolute = path.join(root, relative);
    const stat = await fsp.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error("APPLICATION_QA_SOURCE_SYMLINK_FORBIDDEN");
    if (stat.isFile()) { files.push(relative); return; }
    if (!stat.isDirectory()) throw new Error("APPLICATION_QA_SOURCE_ENTRY_INVALID");
    for (const entry of await fsp.readdir(absolute)) await visit(path.join(relative, entry));
  }
  for (const input of sourceInputs) {
    try { await visit(input); }
    catch (error) {
      if (input === "public" && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`APPLICATION_QA_SOURCE_INPUT_MISSING_${input.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`);
      throw error;
    }
  }
  files.sort((left, right) => left.localeCompare(right, "en"));
  const digest = createHash("sha256");
  for (const relative of files) {
    const bytes = await fsp.readFile(path.join(root, relative));
    const portable = relative.split(path.sep).join("/");
    digest.update(`${Buffer.byteLength(portable)}:${portable}:${bytes.length}:`);
    digest.update(bytes);
  }
  return `sha256:${digest.digest("hex")}`;
}

function commandTimeoutMs() {
  const value = Number(process.env.APPLICATION_QA_COMMAND_TIMEOUT_MS ?? 20 * 60_000);
  if (!Number.isInteger(value) || value < 60_000 || value > 30 * 60_000) throw new Error("APPLICATION_QA_COMMAND_TIMEOUT_INVALID");
  return value;
}

const isolatedTestEnvironmentKeys = [
  "DATABASE_URL", "DATABASE_URL_FILE", "REDIS_URL", "AUTH_SECRET", "AUTH_SECRET_FILE", "ARTIFACT_MASTER_KEY",
  "ARTIFACT_MASTER_KEY_FILE", "ARTIFACT_PREVIOUS_MASTER_KEYS", "ADMIN_API_KEY", "ADMIN_API_KEY_FILE",
  "S3_ACCESS_KEY", "S3_ACCESS_KEY_FILE", "S3_SECRET_KEY", "S3_SECRET_KEY_FILE",
  "SPEC_ASSISTANT_AI_API_KEY", "SPEC_ASSISTANT_AI_API_KEY_FILE",
  "ALERT_WEBHOOK_SECRET", "ALERT_WEBHOOK_SECRET_FILE",
] as const;

function commandEnvironment(profile: "demo-test-isolation" | "file-secret-isolation" | "qa-production-runtime") {
  if (profile === "qa-production-runtime") return process.env;
  const environment = {
    ...process.env,
    PROTOCOL_MODE: profile === "demo-test-isolation" ? "demo" : "production",
    REQUIRE_FILE_SECRETS: "false",
  };
  for (const key of isolatedTestEnvironmentKeys) delete environment[key];
  return environment;
}

async function runCommand(id: string, args: readonly string[], environmentProfile: "demo-test-isolation" | "file-secret-isolation" | "qa-production-runtime", cwd: string, retainStdout = false) {
  const started = new Date();
  const stdout = createHash("sha256");
  const stderr = createHash("sha256");
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const retained: Buffer[] = [];
  let failure: "timeout" | "output" | undefined;
  process.stderr.write(`[application-qa] starting ${id}\n`);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("pnpm", [...args], { cwd, env: commandEnvironment(environmentProfile), stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const finish = (callback: () => void) => { if (!settled) { settled = true; callback(); } };
    const timer = setTimeout(() => { failure = "timeout"; child.kill("SIGKILL"); }, commandTimeoutMs());
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maximumOutputBytes) { failure = "output"; child.kill("SIGKILL"); return; }
      stdout.update(chunk);
      if (retainStdout) retained.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maximumOutputBytes) { failure = "output"; child.kill("SIGKILL"); return; }
      stderr.update(chunk);
    });
    child.on("error", (error) => finish(() => { clearTimeout(timer); reject(error); }));
    child.on("close", (code) => finish(() => { clearTimeout(timer); resolve(code ?? 1); }));
  });
  const completed = new Date();
  if (failure === "timeout") throw new Error(`APPLICATION_QA_COMMAND_TIMEOUT_${id.toUpperCase().replaceAll("-", "_")}`);
  if (failure === "output") throw new Error(`APPLICATION_QA_COMMAND_OUTPUT_LIMIT_${id.toUpperCase().replaceAll("-", "_")}`);
  if (exitCode !== 0) throw new Error(`APPLICATION_QA_COMMAND_FAILED_${id.toUpperCase().replaceAll("-", "_")}`);
  process.stderr.write(`[application-qa] passed ${id}\n`);
  return {
    result: {
      id, executable: "pnpm" as const, args: [...args], environmentProfile,
      startedAt: started.toISOString(), completedAt: completed.toISOString(),
      durationMs: completed.getTime() - started.getTime(), exitCode: 0 as const,
      stdoutSha256: `sha256:${stdout.digest("hex")}`, stderrSha256: `sha256:${stderr.digest("hex")}`,
    },
    retainedStdout: retainStdout ? Buffer.concat(retained).toString("utf8") : undefined,
  };
}

function parseCandidateOutput(stdout: string | undefined) {
  if (!stdout) throw new Error("APPLICATION_QA_CANDIDATE_OUTPUT_MISSING");
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error("APPLICATION_QA_CANDIDATE_OUTPUT_INVALID");
  return candidateReleaseManifestSchema.parse(JSON.parse(stdout.slice(start)));
}

async function writeReport(filename: string, report: ApplicationQaReport) {
  const workspace = `${path.resolve(process.cwd())}${path.sep}`;
  const output = path.resolve(filename);
  if (output.startsWith(workspace)) throw new Error("APPLICATION_QA_REPORT_MUST_BE_OUTSIDE_WORKSPACE");
  const parent = await fsp.lstat(path.dirname(output));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("APPLICATION_QA_REPORT_DIRECTORY_INVALID");
  const handle = await fsp.open(output, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8"); }
  finally { await handle.close(); }
  fs.chmodSync(output, 0o600);
  return output;
}

async function validateOutputTarget(filename: string) {
  const workspace = `${path.resolve(process.cwd())}${path.sep}`;
  const output = path.resolve(filename);
  if (output.startsWith(workspace)) throw new Error("APPLICATION_QA_REPORT_MUST_BE_OUTSIDE_WORKSPACE");
  const parent = await fsp.lstat(path.dirname(output));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("APPLICATION_QA_REPORT_DIRECTORY_INVALID");
  try {
    await fsp.lstat(output);
    throw new Error("APPLICATION_QA_REPORT_ALREADY_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function main() {
  const outputFile = process.env.APPLICATION_QA_REPORT_FILE;
  if (!outputFile) throw new Error("APPLICATION_QA_REPORT_FILE_REQUIRED");
  await validateOutputTarget(outputFile);
  const workspace = process.cwd();
  validateApplicationQaRuntimeEnvironment(process.env, workspace);
  const started = new Date();
  const initialSourceSha256 = await sourceTreeSha256(workspace);
  const packageJson = JSON.parse(await fsp.readFile(path.join(workspace, "package.json"), "utf8")) as { packageManager?: string };
  const results: ApplicationQaReport["commands"] = [];
  let candidateOutput: string | undefined;
  for (const command of requiredApplicationQaCommands) {
    const run = await runCommand(command.id, command.args, command.environmentProfile, workspace, command.id === "candidate-snapshot");
    results.push(run.result);
    if (run.retainedStdout) candidateOutput = run.retainedStdout;
  }
  const candidate = parseCandidateOutput(candidateOutput);
  await verifyCandidatePayload(candidate);
  const manifestPath = path.join(path.resolve(candidate.releaseDirectory), "release-manifest.json");
  const manifestHandle = await fsp.open(manifestPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let manifestBytes: Buffer;
  try {
    const stat = await manifestHandle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) throw new Error("APPLICATION_QA_CANDIDATE_MANIFEST_SIZE_INVALID");
    manifestBytes = await manifestHandle.readFile();
  } finally { await manifestHandle.close(); }
  const storedCandidate = candidateReleaseManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (storedCandidate.buildId !== candidate.buildId || storedCandidate.serverSha256 !== candidate.serverSha256
    || storedCandidate.payloadSha256 !== candidate.payloadSha256
    || storedCandidate.payloadEntries !== candidate.payloadEntries
    || storedCandidate.payloadBytes !== candidate.payloadBytes) throw new Error("APPLICATION_QA_CANDIDATE_OUTPUT_MISMATCH");
  const finalSourceSha256 = await sourceTreeSha256(workspace);
  if (finalSourceSha256 !== initialSourceSha256) throw new Error("APPLICATION_QA_SOURCE_CHANGED_DURING_RUN");
  const completed = new Date();
  const report = applicationQaReportSchema.parse({
    version: 1,
    scope: "agentgrid-production-application-qa",
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    sourceSha256: initialSourceSha256,
    environment: {
      node: process.version, packageManager: packageJson.packageManager ?? "pnpm", platform: process.platform, arch: process.arch,
    },
    candidate: {
      buildId: storedCandidate.buildId, createdAt: storedCandidate.createdAt, serverSha256: storedCandidate.serverSha256,
      payloadSha256: storedCandidate.payloadSha256, payloadEntries: storedCandidate.payloadEntries,
      payloadBytes: storedCandidate.payloadBytes,
      releaseManifestSha256: sha256(manifestBytes),
    },
    commands: results,
  });
  const output = await writeReport(outputFile, report);
  console.log(JSON.stringify({ applicationQaPassed: true, output, candidate: report.candidate, sourceSha256: report.sourceSha256, commands: report.commands.length }));
}

void main().catch((error) => {
  const message = error instanceof Error && /^APPLICATION_QA_[A-Z0-9_]+$/.test(error.message) ? error.message : "APPLICATION_QA_RUN_FAILED";
  console.error(message);
  process.exitCode = 1;
});
