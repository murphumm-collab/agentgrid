import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
const fileSchema = z.object({ path: z.string().min(1).max(180), content: z.string().max(500_000) });
const manifestSchema = z.object({ summary: z.string().min(10).max(1_000), files: z.array(fileSchema).min(1).max(100) });
export type AgentProjectManifest = z.infer<typeof manifestSchema>;

function safeRelativePath(value: string) {
  if (value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) throw new Error("AGENT_ARTIFACT_PATH_INVALID");
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("AGENT_ARTIFACT_PATH_INVALID");
  if (segments[0] === ".git" || segments[0] === "node_modules") throw new Error("AGENT_ARTIFACT_PATH_FORBIDDEN");
  return segments.join("/");
}

export function parseAgentProjectManifest(output: string): AgentProjectManifest {
  const cleaned = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let raw: unknown;
  try { raw = JSON.parse(cleaned); } catch { throw new Error("AI_PROJECT_MANIFEST_INVALID_JSON"); }
  const manifest = manifestSchema.parse(raw);
  let total = 0;
  const seen = new Set<string>();
  for (const file of manifest.files) {
    file.path = safeRelativePath(file.path);
    if (seen.has(file.path)) throw new Error("AGENT_ARTIFACT_DUPLICATE_PATH");
    seen.add(file.path);
    total += Buffer.byteLength(file.content);
  }
  if (total > 5_000_000) throw new Error("AGENT_ARTIFACT_TOTAL_SIZE_EXCEEDED");
  const packageFile = manifest.files.find((file) => file.path === "package.json");
  if (!packageFile) throw new Error("AGENT_ARTIFACT_PACKAGE_JSON_REQUIRED");
  try {
    const packageJson = JSON.parse(packageFile.content) as { scripts?: { test?: unknown } };
    if (typeof packageJson.scripts?.test !== "string") throw new Error("missing");
  } catch { throw new Error("AGENT_ARTIFACT_TEST_SCRIPT_REQUIRED"); }
  return manifest;
}

export async function buildAgentProjectArchive(manifest: AgentProjectManifest) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "agentgrid-project-"));
  const project = path.join(root, "project");
  const archive = path.join(root, "artifact.tar.gz");
  await fs.mkdir(project, { mode: 0o700 });
  try {
    for (const file of manifest.files) {
      const target = path.join(project, file.path);
      if (!target.startsWith(`${project}${path.sep}`)) throw new Error("AGENT_ARTIFACT_PATH_ESCAPE");
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, file.content, { mode: 0o600 });
    }
    await exec("tar", ["-czf", archive, "-C", project, "."], { timeout: 30_000, env: { ...process.env, COPYFILE_DISABLE: "1" } });
    return new Uint8Array(await fs.readFile(archive));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

export async function readAgentProjectArchive(bytes: Uint8Array): Promise<AgentProjectManifest> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "agentgrid-contribution-"));
  const archive = path.join(root, "artifact.tar.gz");
  await fs.writeFile(archive, bytes, { mode: 0o600 });
  try {
    const [listing, verbose] = await Promise.all([
      exec("tar", ["-tzf", archive], { timeout: 30_000, maxBuffer: 200_000 }),
      exec("tar", ["-tvzf", archive], { timeout: 30_000, maxBuffer: 200_000 }),
    ]);
    const archiveEntries = listing.stdout.split("\n").filter(Boolean);
    const entries = archiveEntries.map((entry) => entry.replace(/^\.\//, ""));
    if (!entries.length || verbose.stdout.split("\n").some((line) => /^[lh]/.test(line))) throw new Error("CONTRIBUTION_ARCHIVE_UNSAFE");
    const files: Array<{ path: string; content: string }> = [];
    for (let index = 0; index < archiveEntries.length; index += 1) {
      if (!entries[index] || entries[index].endsWith("/")) continue;
      if (files.length >= 100) throw new Error("AGENT_ARTIFACT_FILE_COUNT_EXCEEDED");
      const safePath = safeRelativePath(entries[index]);
      const extracted = await exec("tar", ["-xOzf", archive, archiveEntries[index]], { timeout: 30_000, maxBuffer: 500_001 });
      if (Buffer.byteLength(extracted.stdout) > 500_000) throw new Error("AGENT_ARTIFACT_FILE_SIZE_EXCEEDED");
      files.push({ path: safePath, content: extracted.stdout });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return parseAgentProjectManifest(JSON.stringify({ summary: "Verified encrypted team contribution archive", files }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
