import { mkdtemp, chmod, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPilotEvidenceFile } from "./pilot-qualification-service";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "agentgrid-pilot-evidence-"));
  directories.push(directory);
  const filename = path.join(directory, "signoff.json");
  await writeFile(filename, "{\"ok\":true}", { mode: 0o600 });
  return { directory, filename };
}

describe("pilot evidence file boundary", () => {
  it("reads a bounded owner-only regular file", async () => {
    const { filename } = await fixture();
    await expect(readPilotEvidenceFile(filename, 64, true)).resolves.toEqual(Buffer.from("{\"ok\":true}"));
  });

  it("rejects permissive sign-off files and oversized evidence", async () => {
    const { filename } = await fixture();
    await chmod(filename, 0o644);
    await expect(readPilotEvidenceFile(filename, 64, true)).rejects.toThrow("PILOT_SIGNOFF_FILE_PERMISSIONS_INVALID");
    await chmod(filename, 0o600);
    await expect(readPilotEvidenceFile(filename, 4, true)).rejects.toThrow("PILOT_EVIDENCE_FILE_SIZE_INVALID");
  });

  it("does not follow a sign-off symlink", async () => {
    const { directory, filename } = await fixture();
    const link = path.join(directory, "signoff-link.json");
    await symlink(filename, link);
    await expect(readPilotEvidenceFile(link, 64, true)).rejects.toThrow();
  });
});
