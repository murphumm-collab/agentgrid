import { createHash } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const candidateReleaseManifestSchema = z.object({
  version: z.literal(2),
  buildId: z.string().min(8).max(128),
  createdAt: z.string().datetime({ offset: true }),
  releaseDirectory: z.string().min(1),
  serverSha256: z.string().regex(/^[0-9a-f]{64}$/),
  payloadSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  payloadEntries: z.number().int().positive(),
  payloadBytes: z.number().int().positive(),
  mutablePaths: z.tuple([z.literal(".next/cache")]),
  payloadReadOnly: z.literal(true),
  immutableSnapshot: z.literal(true),
  activationRequired: z.literal(true),
}).strict();

export type CandidateReleaseManifest = z.infer<typeof candidateReleaseManifestSchema>;

function portable(relative: string) {
  return relative.split(path.sep).join("/");
}

function excluded(relative: string) {
  const name = portable(relative);
  return name === "release-manifest.json" || name === ".next/cache" || name.startsWith(".next/cache/");
}

function inside(root: string, target: string) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

async function safeSymlink(root: string, absolute: string) {
  const target = await fs.readlink(absolute);
  if (path.isAbsolute(target)) throw new Error("CANDIDATE_PAYLOAD_SYMLINK_OUTSIDE_ROOT");
  let resolved: string;
  try { resolved = await fs.realpath(absolute); }
  catch { throw new Error("CANDIDATE_PAYLOAD_SYMLINK_BROKEN"); }
  if (!inside(root, resolved)) throw new Error("CANDIDATE_PAYLOAD_SYMLINK_OUTSIDE_ROOT");
  if (excluded(path.relative(root, resolved))) throw new Error("CANDIDATE_PAYLOAD_SYMLINK_MUTABLE_TARGET_FORBIDDEN");
  return portable(target);
}

export async function candidatePayloadDigest(rootInput: string) {
  const root = await fs.realpath(path.resolve(rootInput));
  const entries: Array<
    | { kind: "file"; relative: string; absolute: string; bytes: number }
    | { kind: "link"; relative: string; target: string; bytes: number }
  > = [];
  async function visit(relative: string) {
    if (relative && excluded(relative)) return;
    const absolute = relative ? path.join(root, relative) : root;
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      const target = await safeSymlink(root, absolute);
      entries.push({ kind: "link", relative: portable(relative), target, bytes: Buffer.byteLength(target) });
      return;
    }
    if (stat.isFile()) {
      if (!relative) throw new Error("CANDIDATE_PAYLOAD_ROOT_INVALID");
      entries.push({ kind: "file", relative: portable(relative), absolute, bytes: stat.size });
      return;
    }
    if (!stat.isDirectory()) throw new Error("CANDIDATE_PAYLOAD_ENTRY_INVALID");
    const directoryEntries = await fs.readdir(absolute);
    directoryEntries.sort((left, right) => left.localeCompare(right, "en"));
    for (const entry of directoryEntries) await visit(relative ? path.join(relative, entry) : entry);
  }
  await visit("");
  if (entries.length < 1) throw new Error("CANDIDATE_PAYLOAD_EMPTY");
  entries.sort((left, right) => left.relative.localeCompare(right.relative, "en"));
  const digest = createHash("sha256");
  let payloadBytes = 0;
  for (const entry of entries) {
    payloadBytes += entry.bytes;
    if (entry.kind === "link") {
      digest.update(`L:${Buffer.byteLength(entry.relative)}:${entry.relative}:${entry.bytes}:${entry.target}`);
      continue;
    }
    const handle = await fs.open(entry.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    let bytes: Buffer;
    try { bytes = await handle.readFile(); }
    finally { await handle.close(); }
    if (bytes.length !== entry.bytes) throw new Error("CANDIDATE_PAYLOAD_CHANGED_DURING_HASH");
    digest.update(`F:${Buffer.byteLength(entry.relative)}:${entry.relative}:${bytes.length}:`);
    digest.update(bytes);
  }
  return { payloadSha256: `sha256:${digest.digest("hex")}`, payloadEntries: entries.length, payloadBytes };
}

export async function verifyCandidatePayload(manifestInput: CandidateReleaseManifest) {
  const manifest = candidateReleaseManifestSchema.parse(manifestInput);
  const actual = await candidatePayloadDigest(manifest.releaseDirectory);
  if (actual.payloadSha256 !== manifest.payloadSha256
    || actual.payloadEntries !== manifest.payloadEntries
    || actual.payloadBytes !== manifest.payloadBytes) throw new Error("CANDIDATE_PAYLOAD_MISMATCH");
  await verifyCandidatePayloadPermissions(manifest.releaseDirectory);
  return actual;
}

async function verifyCandidatePayloadPermissions(rootInput: string) {
  const root = await fs.realpath(path.resolve(rootInput));
  async function visit(relative: string) {
    const absolute = relative ? path.join(root, relative) : root;
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) { await safeSymlink(root, absolute); return; }
    if (portable(relative) === ".next/cache") {
      if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) throw new Error("CANDIDATE_CACHE_PERMISSIONS_INVALID");
      return;
    }
    if ((stat.mode & 0o222) !== 0) throw new Error("CANDIDATE_PAYLOAD_WRITABLE");
    if (stat.isFile()) return;
    if (!stat.isDirectory()) throw new Error("CANDIDATE_PAYLOAD_ENTRY_INVALID");
    for (const entry of await fs.readdir(absolute)) await visit(relative ? path.join(relative, entry) : entry);
  }
  await visit("");
}

export async function sealCandidatePayload(rootInput: string) {
  const root = await fs.realpath(path.resolve(rootInput));
  async function visit(relative: string) {
    const absolute = relative ? path.join(root, relative) : root;
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) { await safeSymlink(root, absolute); return; }
    if (stat.isFile()) { await fs.chmod(absolute, 0o444); return; }
    if (!stat.isDirectory()) throw new Error("CANDIDATE_PAYLOAD_ENTRY_INVALID");
    if (portable(relative) === ".next/cache") { await fs.chmod(absolute, 0o700); return; }
    for (const entry of await fs.readdir(absolute)) await visit(relative ? path.join(relative, entry) : entry);
    await fs.chmod(absolute, 0o555);
  }
  await visit("");
}
