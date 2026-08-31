import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { configuredSecret, requiredSecret } from "../src/lib/secrets";

export function directPgDumpConnection(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("DATABASE_URL_PROTOCOL_INVALID");
  const password = decodeURIComponent(parsed.password);
  parsed.password = "";
  return { databaseUrl: parsed.toString(), password };
}

export function dockerPgDumpDatabase(value = process.env.BACKUP_POSTGRES_DATABASE ?? "agentgrid") {
  if (!/^agentgrid(?:_[a-z0-9_]{1,50})?$/.test(value)) throw new Error("BACKUP_POSTGRES_DATABASE_INVALID");
  return value;
}

async function postgresDump(target: string) {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(target, { mode: 0o600 });
    const direct = process.env.BACKUP_TRANSPORT === "direct";
    let databaseUrl: string | undefined;
    try { databaseUrl = direct ? requiredSecret("DATABASE_URL") : undefined; }
    catch (error) { reject(error); return; }
    const connection = direct ? directPgDumpConnection(databaseUrl!) : undefined;
    const command = direct ? "pg_dump" : "docker";
    const args = direct
      ? ["--dbname", connection!.databaseUrl, "--format=custom", "--no-owner"]
      : ["compose", "exec", "-T", "postgres", "pg_dump", "-U", "agentgrid", "-d", dockerPgDumpDatabase(), "--format=custom", "--no-owner"];
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: direct ? { ...process.env, PGPASSWORD: connection!.password } : process.env,
    });
    let error = "";
    let childSucceeded = false;
    let outputFinished = false;
    let settled = false;
    const succeedWhenComplete = () => {
      if (!settled && childSucceeded && outputFinished) { settled = true; resolve(); }
    };
    const fail = (cause: unknown) => {
      if (!settled) { settled = true; output.destroy(); reject(cause); }
    };
    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => {
      if (Buffer.byteLength(error) < 64 * 1024) error += String(chunk).slice(0, 64 * 1024 - Buffer.byteLength(error));
    });
    output.on("error", fail);
    output.on("finish", () => { outputFinished = true; succeedWhenComplete(); });
    child.on("error", fail);
    child.on("close", (code) => {
      if (code !== 0) { fail(new Error(`PG_DUMP_FAILED_${code}_${error}`)); return; }
      childSucceeded = true;
      succeedWhenComplete();
    });
  });
}

export async function backupChecksum(file: string) {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");
  for await (const chunk of handle.createReadStream()) hash.update(chunk);
  await handle.close();
  return hash.digest("hex");
}

function retentionDays() {
  if (!process.env.BACKUP_RETENTION_DAYS) return null;
  const value = Number(process.env.BACKUP_RETENTION_DAYS);
  if (!Number.isInteger(value) || value < 7 || value > 3_650) throw new Error("BACKUP_RETENTION_DAYS_INVALID");
  return value;
}

export async function pruneLocalBackups(root: string, keepFolder: string, now = Date.now()) {
  const days = retentionDays();
  if (days === null) return 0;
  const cutoff = now - days * 24 * 60 * 60 * 1_000;
  let removed = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T.+Z$/.test(entry.name)) continue;
    const folder = path.join(root, entry.name);
    if (folder === keepFolder || !folder.startsWith(`${root}${path.sep}`)) continue;
    const stat = await fs.stat(folder);
    if (stat.mtimeMs < cutoff) { await fs.rm(folder, { recursive: true }); removed += 1; }
  }
  return removed;
}

export type BackupManifest = {
  createdAt: string;
  postgres: { file: string; bytes: number; sha256: string };
  offHost?: { bucket: string; prefix: string; encryption: "AES256" | "aws:kms" | "none-local-smoke"; endpointClass: "aws-default" | "https-custom" | "local-smoke" };
};

export function backupObjectStorageConfiguration() {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) throw new Error("BACKUP_S3_BUCKET_REQUIRED");
  const configuredAccessKey = configuredSecret("BACKUP_S3_ACCESS_KEY");
  const configuredSecretKey = configuredSecret("BACKUP_S3_SECRET_KEY");
  const accessKeyId = configuredAccessKey.value ? requiredSecret("BACKUP_S3_ACCESS_KEY") : undefined;
  const secretAccessKey = configuredSecretKey.value ? requiredSecret("BACKUP_S3_SECRET_KEY") : undefined;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw new Error("BACKUP_S3_CREDENTIAL_PAIR_REQUIRED");
  const rawPrefix = process.env.BACKUP_S3_PREFIX ?? "agentgrid-backups";
  const prefix = rawPrefix.replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("BACKUP_S3_PREFIX_INVALID");
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const kmsKeyId = process.env.BACKUP_S3_KMS_KEY_ID;
  let endpointClass: "aws-default" | "https-custom" | "local-smoke" = "aws-default";
  if (endpoint) {
    const parsedEndpoint = new URL(endpoint);
    if (parsedEndpoint.protocol === "https:") endpointClass = "https-custom";
    else if (parsedEndpoint.protocol === "http:" && process.env.BACKUP_OFFHOST_LOCAL_SMOKE === "true") endpointClass = "local-smoke";
    else throw new Error("BACKUP_S3_HTTPS_REQUIRED");
  }
  if (endpointClass !== "local-smoke" && !kmsKeyId) throw new Error("BACKUP_S3_KMS_KEY_REQUIRED");
  const client = new S3Client({
    region: process.env.BACKUP_S3_REGION ?? "us-east-1",
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  return { bucket, prefix, endpoint, endpointClass, kmsKeyId, client };
}

async function uploadOffHost(folder: string, manifest: BackupManifest) {
  if (!process.env.BACKUP_S3_BUCKET) return false;
  const { bucket, prefix, endpointClass, kmsKeyId, client } = backupObjectStorageConfiguration();
  const objectPrefix = `${prefix}/${path.basename(folder)}`;
  const offHost: NonNullable<BackupManifest["offHost"]> = {
    bucket,
    prefix: objectPrefix,
    encryption: kmsKeyId ? "aws:kms" : endpointClass === "local-smoke" ? "none-local-smoke" : "AES256",
    endpointClass,
  };
  const completedManifest: BackupManifest = { ...manifest, offHost };
  const manifestBytes = Buffer.from(`${JSON.stringify(completedManifest, null, 2)}\n`);
  const encryption = kmsKeyId
    ? { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: kmsKeyId }
    : endpointClass === "local-smoke" ? {} : { ServerSideEncryption: "AES256" as const };
  const dumpKey = `${objectPrefix}/postgres.dump`;
  const manifestKey = `${objectPrefix}/manifest.json`;
  await client.send(new PutObjectCommand({
    Bucket: bucket, Key: dumpKey, Body: createReadStream(path.join(folder, manifest.postgres.file)),
    ContentLength: manifest.postgres.bytes, Metadata: { sha256: manifest.postgres.sha256 },
    ChecksumSHA256: Buffer.from(manifest.postgres.sha256, "hex").toString("base64"), ...encryption,
  }));
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: manifestKey, Body: manifestBytes, ContentLength: manifestBytes.length, ...encryption }));
  const verified = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: dumpKey, ChecksumMode: "ENABLED" }));
  if (verified.ContentLength !== manifest.postgres.bytes || verified.Metadata?.sha256 !== manifest.postgres.sha256) throw new Error("BACKUP_OFFHOST_VERIFICATION_FAILED");
  await writeBackupManifestAtomic(folder, completedManifest);
  manifest.offHost = offHost;
  return true;
}

export async function writeBackupManifestAtomic(folder: string, manifest: BackupManifest) {
  const target = path.join(folder, "manifest.json");
  const temporary = path.join(folder, `.manifest-${process.pid}-${Date.now()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try { await fs.rename(temporary, target); }
  catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; }
}

export async function runBackup() {
  const root = path.resolve(process.env.BACKUP_DIRECTORY ?? path.join(process.cwd(), ".backups"));
  const folder = path.join(root, new Date().toISOString().replace(/[:.]/g, "-"));
  if (!folder.startsWith(`${root}${path.sep}`)) throw new Error("BACKUP_PATH_INVALID");
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const dump = path.join(folder, "postgres.dump");
  await postgresDump(dump);
  const stat = await fs.stat(dump);
  if (stat.size < 1_024) throw new Error("BACKUP_DUMP_TOO_SMALL");
  const manifest: BackupManifest = { createdAt: new Date().toISOString(), postgres: { file: "postgres.dump", bytes: stat.size, sha256: await backupChecksum(dump) } };
  await writeBackupManifestAtomic(folder, manifest);
  const offHostCopied = await uploadOffHost(folder, manifest);
  const prunedLocalFolders = await pruneLocalBackups(root, folder);
  const report = { backup: folder, ...manifest, offHostCopied, prunedLocalFolders };
  console.log(JSON.stringify(report));
  return report;
}
