import { createDecipheriv, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const maxOutput = 200_000;

export interface SandboxReport {
  passed: boolean;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  testsPassed: boolean;
  hiddenTestsPassed: boolean;
  lineCoverage: number;
  branchCoverage: number;
  functionCoverage: number;
  criticalBranchCoverage: number;
  stdout: string;
  stderr: string;
  sandbox: { network: "none"; readOnlyRoot: true; memoryMb: number; cpus: number; pids: number; image: string };
}

type EncryptedDownload = { downloadUrl: string; artifactHash: string; ciphertextHash: string; decryptionKey: string; contentIv: string };

export async function decryptArtifactDownload(input: EncryptedDownload) {
  const response = await fetch(input.downloadUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`ARTIFACT_DOWNLOAD_FAILED_${response.status}`);
  const encrypted = Buffer.from(await response.arrayBuffer());
  const cipherHash = createHash("sha256").update(encrypted).digest("hex");
  if (`sha256:${cipherHash}` !== input.ciphertextHash) throw new Error("DOWNLOADED_CIPHERTEXT_HASH_MISMATCH");
  if (encrypted.length < 17) throw new Error("ENCRYPTED_ARTIFACT_INVALID");
  const tag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(input.decryptionKey, "base64"), Buffer.from(input.contentIv, "base64"));
  decipher.setAuthTag(tag);
  const bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (`sha256:${hash}` !== input.artifactHash) throw new Error("DECRYPTED_ARTIFACT_HASH_MISMATCH");
  return bytes;
}

export async function downloadAndRunSandbox(input: EncryptedDownload & { hiddenTest: EncryptedDownload }) {
  const [delivery, hiddenTest] = await Promise.all([decryptArtifactDownload(input), decryptArtifactDownload(input.hiddenTest)]);
  return runSandboxArchive(delivery, hiddenTest);
}

async function assertSafeArchive(archivePath: string, kind: "delivery" | "hidden-test") {
  const [{ stdout }, verbose] = await Promise.all([
    exec("tar", ["-tzf", archivePath], { timeout: 30_000, maxBuffer: maxOutput }),
    exec("tar", ["-tvzf", archivePath], { timeout: 30_000, maxBuffer: maxOutput }),
  ]);
  const entries = stdout.split("\n").filter(Boolean).map((entry) => entry.replace(/^\.\//, ""));
  const containsLinks = verbose.stdout.split("\n").some((line) => /^[lh]/.test(line));
  if (!entries.length || containsLinks || entries.some((entry) => entry.startsWith("/") || entry.split("/").includes("..") || entry.includes("\\") || entry.includes("\0"))) {
    throw new Error(`${kind.toUpperCase().replace("-", "_")}_ARCHIVE_UNSAFE`);
  }
  if (kind === "hidden-test" && !entries.some((entry) => /(?:^|\/)\w[^/]*\.test\.(?:mjs|js)$/.test(entry))) throw new Error("HIDDEN_TEST_ARCHIVE_HAS_NO_TESTS");
}

export async function runSandboxArchive(bytes: Uint8Array, hiddenTestBytes?: Uint8Array): Promise<SandboxReport> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "agentgrid-sandbox-"));
  const inputDir = path.join(root, "input");
  const verifierDir = path.join(root, "verifier");
  await fs.mkdir(inputDir, { mode: 0o755 });
  await fs.mkdir(verifierDir, { mode: 0o755 });
  await fs.writeFile(path.join(inputDir, "artifact.tar.gz"), bytes, { mode: 0o644 });
  await assertSafeArchive(path.join(inputDir, "artifact.tar.gz"), "delivery");
  if (hiddenTestBytes) {
    await fs.writeFile(path.join(inputDir, "hidden-tests.tar.gz"), hiddenTestBytes, { mode: 0o644 });
    await assertSafeArchive(path.join(inputDir, "hidden-tests.tar.gz"), "hidden-test");
  }
  await fs.writeFile(path.join(verifierDir, "preload.mjs"), [
    "import {readdir} from 'node:fs/promises';",
    "import {join} from 'node:path';",
    "import {pathToFileURL} from 'node:url';",
    "async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name.startsWith('._'))continue;const file=join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(/\\.(?:mjs|js)$/.test(entry.name))await import(pathToFileURL(file).href)}}",
    "await walk('/tmp/work/src');",
  ].join("\n"), { mode: 0o644 });
  const image = process.env.SANDBOX_IMAGE ?? "node:22-alpine";
  const started = Date.now();
  let stdout = ""; let stderr = ""; let exitCode = 0; let timedOut = false;
  const script = [
    "set -eu", "mkdir -p /tmp/work", "tar -xzf /input/artifact.tar.gz -C /tmp/work",
    "cd /tmp/work", "test -f package.json", "test -d src", "test -d test",
    ...(hiddenTestBytes ? ["mkdir -p /tmp/work/test/hidden", "tar -xzf /input/hidden-tests.tar.gz -C /tmp/work/test/hidden"] : []),
    "node --import /verifier/preload.mjs --test --experimental-test-coverage --test-coverage-include='src/**/*.js' --test-coverage-include='src/**/*.mjs' --test-coverage-lines=90 --test-coverage-branches=95 --test-coverage-functions=95",
  ].join(" && ");
  try {
    const result = await exec("docker", ["run", "--rm", "--network", "none", "--read-only", "--memory", "512m", "--cpus", "1", "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--user", "65534:65534", "--tmpfs", "/tmp:rw,nosuid,size=128m", "--mount", `type=bind,src=${inputDir},dst=/input,readonly`, "--mount", `type=bind,src=${verifierDir},dst=/verifier,readonly`, image, "sh", "-lc", script], { timeout: 10 * 60_000, maxBuffer: maxOutput });
    stdout = result.stdout; stderr = result.stderr;
  } catch (error) {
    const failure = error as Error & { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
    exitCode = typeof failure.code === "number" ? failure.code : 1;
    timedOut = Boolean(failure.killed);
    stdout = failure.stdout ?? ""; stderr = failure.stderr ?? failure.message;
  }
  let lineCoverage = 0; let branchCoverage = 0; let functionCoverage = 0;
  const coverage = stdout.match(/# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/);
  if (coverage) { lineCoverage = Number(coverage[1]) / 100; branchCoverage = Number(coverage[2]) / 100; functionCoverage = Number(coverage[3]) / 100; }
  await fs.rm(root, { recursive: true, force: true });
  const passed = exitCode === 0 && lineCoverage >= 0.9 && branchCoverage >= 0.95 && functionCoverage >= 0.95;
  return {
    passed, exitCode, timedOut, durationMs: Date.now() - started, testsPassed: exitCode === 0,
    hiddenTestsPassed: Boolean(hiddenTestBytes) && exitCode === 0, lineCoverage, branchCoverage, functionCoverage, criticalBranchCoverage: branchCoverage,
    stdout: stdout.slice(-50_000), stderr: stderr.slice(-50_000),
    sandbox: { network: "none", readOnlyRoot: true, memoryMb: 512, cpus: 1, pids: 128, image },
  };
}
