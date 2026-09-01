import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("local demo network boundary", () => {
  it("binds the development server to loopback only", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.dev).toContain("--hostname 127.0.0.1");
  });
});

