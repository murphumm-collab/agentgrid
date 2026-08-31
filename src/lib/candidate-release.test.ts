import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  candidatePayloadDigest, candidateReleaseManifestSchema, sealCandidatePayload, verifyCandidatePayload,
  type CandidateReleaseManifest,
} from "./candidate-release";

const temporaryRoots: string[] = [];

async function makeWritable(target: string) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await chmod(target, 0o700);
    for (const entry of await readdir(target)) await makeWritable(path.join(target, entry));
  } else if (stat.isFile()) await chmod(target, 0o600);
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    try { await makeWritable(root); } catch { /* already absent */ }
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const parent = await mkdtemp(path.join(tmpdir(), "agentgrid-candidate-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "release");
  await mkdir(path.join(root, ".next", "static", "chunks"), { recursive: true });
  await mkdir(path.join(root, ".next", "cache"), { recursive: true, mode: 0o700 });
  await mkdir(path.join(root, ".store", "package"), { recursive: true });
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await writeFile(path.join(root, "server.js"), "server-v1");
  await writeFile(path.join(root, ".next", "static", "chunks", "app.js"), "chunk-v1");
  await writeFile(path.join(root, ".store", "package", "index.js"), "package-v1");
  await symlink("../.store/package", path.join(root, "node_modules", "package"));
  const payload = await candidatePayloadDigest(root);
  const manifest = candidateReleaseManifestSchema.parse({
    version: 2,
    buildId: "candidate-build-v2",
    createdAt: "2026-08-31T00:00:00.000Z",
    releaseDirectory: root,
    serverSha256: "1".repeat(64),
    ...payload,
    mutablePaths: [".next/cache"],
    payloadReadOnly: true,
    immutableSnapshot: true,
    activationRequired: true,
  });
  await writeFile(path.join(root, "release-manifest.json"), JSON.stringify(manifest));
  await sealCandidatePayload(root);
  return { parent, root, manifest };
}

describe("candidate release payload", () => {
  it("binds every payload file and verifies the sealed read-only snapshot", async () => {
    const { root, manifest } = await fixture();
    await expect(verifyCandidatePayload(manifest)).resolves.toMatchObject({
      payloadSha256: manifest.payloadSha256,
      payloadEntries: 4,
    });
    expect((await lstat(root)).mode & 0o222).toBe(0);
    expect((await lstat(path.join(root, "server.js"))).mode & 0o222).toBe(0);
    expect((await lstat(path.join(root, ".next", "cache"))).mode & 0o077).toBe(0);
  });

  it("detects a changed chunk even when server.js is unchanged", async () => {
    const { root, manifest } = await fixture();
    const chunk = path.join(root, ".next", "static", "chunks", "app.js");
    await chmod(chunk, 0o600);
    await writeFile(chunk, "substituted-chunk");
    await expect(verifyCandidatePayload(manifest)).rejects.toThrow("CANDIDATE_PAYLOAD_MISMATCH");
  });

  it("rejects escaping symlinks and legacy manifests without a complete payload binding", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "agentgrid-candidate-symlink-"));
    temporaryRoots.push(parent);
    await writeFile(path.join(parent, "outside"), "outside");
    const root = path.join(parent, "release");
    await mkdir(root);
    await symlink(path.join(parent, "outside"), path.join(root, "server.js"));
    await expect(candidatePayloadDigest(root)).rejects.toThrow("CANDIDATE_PAYLOAD_SYMLINK_OUTSIDE_ROOT");
    expect(() => candidateReleaseManifestSchema.parse({
      version: 1, buildId: "legacy-build", createdAt: "2026-08-31T00:00:00.000Z",
      releaseDirectory: root, serverSha256: "1".repeat(64), immutableSnapshot: true, activationRequired: true,
    } as unknown as CandidateReleaseManifest)).toThrow();
  });
});
