import { describe, expect, it } from "vitest";
import { buildAgentProjectArchive, parseAgentProjectManifest, readAgentProjectArchive } from "./agent-artifact-builder";

const valid = JSON.stringify({ summary: "A complete tested Node project.", files: [
  { path: "package.json", content: JSON.stringify({ scripts: { test: "node test.js" } }) },
  { path: "src/index.js", content: "export const ok = true;" },
  { path: "test.js", content: "console.log('ok');" },
] });

describe("AI project artifact builder", () => {
  it("builds a real gzip project archive", async () => {
    const manifest = parseAgentProjectManifest(`\`\`\`json\n${valid}\n\`\`\``);
    const archive = await buildAgentProjectArchive(manifest);
    expect(archive.byteLength).toBeGreaterThan(100);
    expect([...archive.slice(0, 2)]).toEqual([0x1f, 0x8b]);
    const restored = await readAgentProjectArchive(archive);
    expect(restored.files).toEqual(manifest.files);
  });

  it.each(["../secret", "/etc/passwd", "src\\escape.js", "node_modules/pwn.js", ".git/config"])("rejects unsafe path %s", (unsafe) => {
    const payload = JSON.parse(valid); payload.files[1].path = unsafe;
    expect(() => parseAgentProjectManifest(JSON.stringify(payload))).toThrow(/PATH/);
  });

  it("requires an executable test contract", () => {
    const payload = JSON.parse(valid); payload.files[0].content = JSON.stringify({ scripts: {} });
    expect(() => parseAgentProjectManifest(JSON.stringify(payload))).toThrow("AGENT_ARTIFACT_TEST_SCRIPT_REQUIRED");
  });
});
