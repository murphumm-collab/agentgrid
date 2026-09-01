import { describe, expect, it } from "vitest";
import { readBoundedResponseBytes, readBoundedResponseText } from "./outbound-response";

const errors = {
  missingBody: "MISSING_BODY",
  tooLarge: "TOO_LARGE",
  invalidContentLength: "INVALID_LENGTH",
  invalidUtf8: "INVALID_UTF8",
};

describe("bounded outbound responses", () => {
  it("rejects an oversized declared response before reading its body", async () => {
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } });
    const response = new Response(body, { headers: { "content-length": "9" } });
    await expect(readBoundedResponseBytes(response, 8, errors)).rejects.toThrow("TOO_LARGE");
    expect(response.body?.locked).toBe(false);
    await expect(response.body?.getReader().read()).resolves.toMatchObject({ done: false });
  });

  it("stops a chunked response as soon as its streamed byte limit is exceeded", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(4)); },
      cancel() { cancelled = true; },
    });
    await expect(readBoundedResponseBytes(new Response(body), 8, errors)).rejects.toThrow("TOO_LARGE");
    expect(cancelled).toBe(true);
  });

  it("joins valid chunks and rejects malformed UTF-8", async () => {
    const textBody = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("hello ")); controller.enqueue(new TextEncoder().encode("agent")); controller.close(); } });
    await expect(readBoundedResponseText(new Response(textBody), 32, errors)).resolves.toBe("hello agent");
    await expect(readBoundedResponseText(new Response(new Uint8Array([0xc3, 0x28])), 8, errors)).rejects.toThrow("INVALID_UTF8");
  });

  it("rejects ambiguous content lengths", async () => {
    const response = new Response("x", { headers: { "content-length": "+1" } });
    await expect(readBoundedResponseBytes(response, 8, errors)).rejects.toThrow("INVALID_LENGTH");
  });
});
