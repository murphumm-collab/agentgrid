import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSandboxArchive } from "./sandbox";

const original = process.env.SANDBOX_TEMP_DIRECTORY;

afterEach(() => {
  if (original === undefined) delete process.env.SANDBOX_TEMP_DIRECTORY;
  else process.env.SANDBOX_TEMP_DIRECTORY = original;
});

describe.sequential("sandbox bind-mount root", () => {
  it("rejects relative configured directories before invoking Docker", async () => {
    process.env.SANDBOX_TEMP_DIRECTORY = "relative/sandbox";
    await expect(runSandboxArchive(new Uint8Array())).rejects.toThrow("SANDBOX_TEMP_DIRECTORY_INVALID");
  });

  it("rejects group/world-writable configured directories", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentgrid-unsafe-sandbox-root-"));
    try {
      await chmod(directory, 0o777);
      process.env.SANDBOX_TEMP_DIRECTORY = directory;
      await expect(runSandboxArchive(new Uint8Array())).rejects.toThrow("SANDBOX_TEMP_DIRECTORY_UNSAFE");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

