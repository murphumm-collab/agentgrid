import { afterEach, describe, expect, it } from "vitest";
import { openArtifactKey, rewrapArtifactKey, sealArtifactKey } from "./artifact-crypto";
import { resetRuntimeConfigForTests } from "./env";

const previous = { ...process.env };
afterEach(() => { process.env = { ...previous }; resetRuntimeConfigForTests(); });

describe("artifact key envelope", () => {
  it("seals the agent key and only opens it with the server master key", () => {
    process.env.ARTIFACT_MASTER_KEY = "11".repeat(32); resetRuntimeConfigForTests();
    const key = Buffer.alloc(32, 7).toString("base64");
    const sealed = sealArtifactKey(key);
    expect(sealed.sealedKey).not.toBe(key);
    expect(openArtifactKey(sealed)).toBe(key);
  });

  it("opens an old envelope during rotation and rewraps it under the active key", () => {
    const oldMasterKey = "22".repeat(32);
    const newMasterKey = "33".repeat(32);
    const key = Buffer.alloc(32, 9).toString("base64");
    process.env.ARTIFACT_MASTER_KEY = oldMasterKey;
    resetRuntimeConfigForTests();
    const oldEnvelope = sealArtifactKey(key);

    process.env.ARTIFACT_MASTER_KEY = newMasterKey;
    process.env.ARTIFACT_PREVIOUS_MASTER_KEYS = oldMasterKey;
    resetRuntimeConfigForTests();
    const rotated = rewrapArtifactKey(oldEnvelope);
    expect(openArtifactKey(rotated)).toBe(key);

    delete process.env.ARTIFACT_PREVIOUS_MASTER_KEYS;
    resetRuntimeConfigForTests();
    expect(openArtifactKey(rotated)).toBe(key);
    expect(() => openArtifactKey(oldEnvelope)).toThrow("ARTIFACT_KEY_DECRYPTION_FAILED");
  });
});
