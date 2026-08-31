import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyEncryptedPlaintextChunks } from "./artifacts";

async function* chunks(bytes: Buffer, sizes: number[]) {
  let offset = 0;
  for (const size of sizes) { yield bytes.subarray(offset, offset + size); offset += size; }
  if (offset < bytes.length) yield bytes.subarray(offset);
}

describe("encrypted artifact finalization", () => {
  it("verifies AES-GCM authentication and the declared plaintext hash across chunk boundaries", async () => {
    const key = randomBytes(32); const iv = randomBytes(12); const plaintext = Buffer.from("verified business artifact".repeat(100));
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const hash = createHash("sha256").update(plaintext).digest("hex");
    await expect(verifyEncryptedPlaintextChunks(chunks(encrypted, [1, 7, encrypted.length - 13]), key, iv, hash)).resolves.toBe(true);
    await expect(verifyEncryptedPlaintextChunks(chunks(encrypted, [encrypted.length]), key, iv, "0".repeat(64))).rejects.toThrow("ARTIFACT_PLAINTEXT_HASH_MISMATCH");
  });

  it("rejects an invalid authentication tag", async () => {
    const key = randomBytes(32); const iv = randomBytes(12); const encrypted = Buffer.concat([Buffer.from("broken"), Buffer.alloc(16)]);
    await expect(verifyEncryptedPlaintextChunks(chunks(encrypted, [2, 3]), key, iv, "0".repeat(64))).rejects.toThrow("ARTIFACT_DECRYPTION_VERIFICATION_FAILED");
  });
});
