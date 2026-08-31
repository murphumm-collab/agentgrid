import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { candidatePayloadDigest, candidateReleaseManifestSchema, sealCandidatePayload } from "../src/lib/candidate-release";

async function main() {
  const workspace = process.cwd();
  const standalone = path.join(workspace, ".next", "standalone");
  const staticAssets = path.join(workspace, ".next", "static");
  const buildId = (await readFile(path.join(workspace, ".next", "BUILD_ID"), "utf8")).trim();
  const releaseRoot = process.env.LOCAL_RELEASE_ROOT
    ? path.resolve(process.env.LOCAL_RELEASE_ROOT)
    : path.resolve(workspace, "..", "local-releases");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const releaseDirectory = path.join(releaseRoot, `agentgrid-${stamp}-${buildId.slice(0, 8)}`);

  await mkdir(releaseRoot, { recursive: true });
  await cp(standalone, releaseDirectory, {
    recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true,
  });
  await mkdir(path.join(releaseDirectory, ".next"), { recursive: true });
  await cp(staticAssets, path.join(releaseDirectory, ".next", "static"), {
    recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true,
  });
  try {
    await cp(path.join(workspace, "public"), path.join(releaseDirectory, "public"), {
      recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(path.join(releaseDirectory, ".next", "cache"), { recursive: true, mode: 0o700 });

  const server = await readFile(path.join(releaseDirectory, "server.js"));
  const payload = await candidatePayloadDigest(releaseDirectory);
  const manifest = candidateReleaseManifestSchema.parse({
    version: 2,
    buildId,
    createdAt: new Date().toISOString(),
    releaseDirectory,
    serverSha256: createHash("sha256").update(server).digest("hex"),
    ...payload,
    mutablePaths: [".next/cache"],
    payloadReadOnly: true,
    immutableSnapshot: true,
    activationRequired: true,
  });
  await writeFile(path.join(releaseDirectory, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o444 });
  await sealCandidatePayload(releaseDirectory);
  console.log(JSON.stringify(manifest, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
