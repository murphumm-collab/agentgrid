import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReleaseEvidenceFile } from "./production-release-service";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentgrid-release-evidence-"));
  directories.push(root);
  const filename = path.join(root, "report.json");
  await writeFile(filename, "{\"verified\":true}", { mode: 0o600 });
  return { root, filename };
}

describe("production release evidence file boundary", () => {
  it("reads a bounded non-writable report within the evidence root", async () => {
    const { root } = await fixture();
    await expect(readReleaseEvidenceFile(root, "report.json", 64)).resolves.toEqual(Buffer.from("{\"verified\":true}"));
  });

  it("rejects traversal, permissive files, oversized reports and symlinks", async () => {
    const { root, filename } = await fixture();
    await expect(readReleaseEvidenceFile(root, "../report.json", 64)).rejects.toThrow("PRODUCTION_RELEASE_EVIDENCE_PATH_OUTSIDE_ROOT");
    await chmod(filename, 0o666);
    await expect(readReleaseEvidenceFile(root, "report.json", 64)).rejects.toThrow("PRODUCTION_RELEASE_EVIDENCE_FILE_WRITABLE_BY_OTHERS");
    await chmod(filename, 0o600);
    await expect(readReleaseEvidenceFile(root, "report.json", 4)).rejects.toThrow("PRODUCTION_RELEASE_EVIDENCE_FILE_SIZE_INVALID");
    const link = path.join(root, "link.json");
    await symlink(filename, link);
    await expect(readReleaseEvidenceFile(root, "link.json", 64)).rejects.toThrow();
  });
});
