import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants, createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { backupChecksum } from "./backup";
import { writeNewEvidenceFile as writeEvidenceFile } from "../src/lib/evidence-file";

const exec = promisify(execFile);
export const backupManifestSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  postgres: z.object({
    file: z.literal("postgres.dump"), bytes: z.number().int().min(1024), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
  offHost: z.object({
    bucket: z.string().min(3), prefix: z.string().min(1), encryption: z.enum(["AES256", "aws:kms", "none-local-smoke"]),
    endpointClass: z.enum(["aws-default", "https-custom", "local-smoke"]),
  }).strict().optional(),
}).strict();
export type BackupManifest = z.infer<typeof backupManifestSchema>;

async function dockerPostgres(args: string[]) {
  return exec("docker", ["compose", "exec", "-T", "postgres", ...args], { cwd: process.cwd(), maxBuffer: 1024 * 1024 });
}

async function boundedFile(filename: string, maximum: number) {
  const handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) throw new Error("BACKUP_EVIDENCE_FILE_SIZE_INVALID");
    if ((stat.mode & 0o022) !== 0) throw new Error("BACKUP_EVIDENCE_FILE_WRITABLE_BY_OTHERS");
    return await handle.readFile();
  } finally { await handle.close(); }
}

export async function verifyLocalBackup(folder: string) {
  const manifestPath = path.join(folder, "manifest.json");
  const manifestBytes = await boundedFile(manifestPath, 1024 * 1024);
  const manifest = backupManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const dumpPath = path.join(folder, manifest.postgres.file);
  const dumpHandle = await fs.open(dumpPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await dumpHandle.stat();
    if (!stat.isFile() || stat.size !== manifest.postgres.bytes) throw new Error("BACKUP_SIZE_MISMATCH");
    if ((stat.mode & 0o022) !== 0) throw new Error("BACKUP_DUMP_WRITABLE_BY_OTHERS");
  } finally { await dumpHandle.close(); }
  if (await backupChecksum(dumpPath) !== manifest.postgres.sha256) throw new Error("BACKUP_CHECKSUM_MISMATCH");
  return {
    folder, dumpPath, manifest, manifestBytes,
    manifestSha256: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
  };
}

async function restoreDumpFile(database: string, dumpPath: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", ["compose", "exec", "-T", "postgres", "pg_restore", "-U", "agentgrid", "-d", database, "--no-owner"], {
      cwd: process.cwd(), stdio: ["pipe", "ignore", "pipe"],
    });
    const input = createReadStream(dumpPath);
    let error = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(error) < 64 * 1024) error += String(chunk).slice(0, 64 * 1024 - Buffer.byteLength(error));
    });
    input.on("error", (cause) => { child.kill("SIGKILL"); reject(cause); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`PG_RESTORE_FAILED_${code}_${error}`)));
    input.pipe(child.stdin);
  });
}

export async function restoreVerifiedBackupDump(dumpPath: string) {
  const database = `agentgrid_restore_${Date.now()}_${randomBytes(4).toString("hex")}`;
  if (!/^agentgrid_restore_\d+_[0-9a-f]{8}$/.test(database)) throw new Error("RESTORE_DATABASE_NAME_INVALID");
  await dockerPostgres(["createdb", "-U", "agentgrid", database]);
  let coreTables = 0;
  let completedAt = "";
  try {
    await restoreDumpFile(database, dumpPath);
    const { stdout } = await dockerPostgres([
      "psql", "-U", "agentgrid", "-d", database, "-tAc",
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('protocol_state','chain_events','artifact_manifests','hidden_test_manifests','signed_test_evidence','signed_task_evaluations','job_outbox','notifications','artifact_release_audit','business_adoption_attestations');",
    ]);
    coreTables = Number(stdout.trim());
    if (coreTables !== 10) throw new Error(`RESTORE_CORE_TABLES_MISSING_${coreTables}`);
    completedAt = new Date().toISOString();
  } finally {
    await dockerPostgres(["dropdb", "-U", "agentgrid", "--if-exists", database]);
  }
  return { completedAt, checksumVerified: true as const, coreTables: 10 as const, isolatedDatabaseDropped: true as const };
}

export async function resolveBackupFolder() {
  const root = path.resolve(process.env.BACKUP_DIRECTORY ?? path.join(process.cwd(), ".backups"));
  const folders = (await fs.readdir(root)).sort().reverse();
  const folder = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, folders[0] ?? "");
  if (!folder.startsWith(`${root}${path.sep}`)) throw new Error("BACKUP_VERIFY_PATH_OUTSIDE_ROOT");
  const stat = await fs.lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("BACKUP_VERIFY_DIRECTORY_INVALID");
  return folder;
}

export async function writeNewEvidenceFile(filename: string, value: unknown) {
  return writeEvidenceFile(filename, value, "BACKUP_EVIDENCE");
}
