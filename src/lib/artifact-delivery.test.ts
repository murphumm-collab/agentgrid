import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadPublisherCiphertext } from "./artifact-delivery";

afterEach(() => vi.unstubAllGlobals());

describe("publisher artifact download", () => {
  it("uses a finite timeout, rejects redirects and returns the exact committed bytes", async () => {
    const bytes = new Uint8Array(17).fill(7);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(bytes, { headers: { "content-length": "17" } });
    }));
    await expect(downloadPublisherCiphertext("https://storage.example/release", 17)).resolves.toEqual(bytes);
  });

  it("rejects oversized and truncated ciphertext responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(18))));
    await expect(downloadPublisherCiphertext("https://storage.example/release", 17)).rejects.toThrow("ARTIFACT_DOWNLOAD_TOO_LARGE");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(16))));
    await expect(downloadPublisherCiphertext("https://storage.example/release", 17)).rejects.toThrow("ARTIFACT_DOWNLOAD_SIZE_MISMATCH");
  });
});
