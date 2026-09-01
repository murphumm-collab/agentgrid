import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptArtifactDownload } from "./sandbox";

function fixture() {
  const plaintext = Buffer.from("bounded encrypted artifact");
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return {
    plaintext,
    encrypted,
    input: {
      downloadUrl: "https://storage.example/artifact",
      artifactHash: `sha256:${createHash("sha256").update(plaintext).digest("hex")}`,
      ciphertextHash: `sha256:${createHash("sha256").update(encrypted).digest("hex")}`,
      decryptionKey: key.toString("base64"),
      contentIv: iv.toString("base64"),
      sizeBytes: encrypted.byteLength,
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("tester artifact download", () => {
  it("decrypts only the exact committed ciphertext length and rejects redirects", async () => {
    const value = fixture();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(value.encrypted, { headers: { "content-length": String(value.encrypted.byteLength) } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(decryptArtifactDownload(value.input)).resolves.toEqual(value.plaintext);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("stops a chunked response when it exceeds the committed size", async () => {
    const value = fixture();
    const oversized = Buffer.concat([value.encrypted, Buffer.from([0])]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(oversized.subarray(0, value.input.sizeBytes)); controller.enqueue(oversized.subarray(value.input.sizeBytes)); controller.close(); },
    }))));
    await expect(decryptArtifactDownload(value.input)).rejects.toThrow("ARTIFACT_DOWNLOAD_TOO_LARGE");
  });

  it("rejects a truncated response before attempting decryption", async () => {
    const value = fixture();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(value.encrypted.subarray(0, -1))));
    await expect(decryptArtifactDownload(value.input)).rejects.toThrow("ARTIFACT_DOWNLOAD_SIZE_MISMATCH");
  });
});
