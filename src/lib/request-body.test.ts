import { describe, expect, it } from "vitest";
import { readBinaryBody, readJsonBody } from "./request-body";

function request(body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("https://agentgrid.example/api/test", { method: "POST", headers, body });
}

describe("bounded JSON request bodies", () => {
  it("accepts JSON and structured +json media types", async () => {
    await expect(readJsonBody<{ value: number }>(request('{"value":1}'))).resolves.toEqual({ value: 1 });
    await expect(readJsonBody(request("{}", { "content-type": "application/problem+json; charset=utf-8" }))).resolves.toEqual({});
  });

  it("rejects missing media type and compressed bodies", async () => {
    await expect(readJsonBody(request("{}", {}))).rejects.toThrow("JSON_CONTENT_TYPE_REQUIRED");
    await expect(readJsonBody(request("{}", { "content-type": "application/json", "content-encoding": "gzip" }))).rejects.toThrow("CONTENT_ENCODING_UNSUPPORTED");
  });

  it("rejects an oversized declared body before reading", async () => {
    await expect(readJsonBody(request("{}", { "content-type": "application/json", "content-length": "999" }), 16)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
    await expect(readJsonBody(request("{}", { "content-type": "application/json", "content-length": "invalid" }))).rejects.toThrow("CONTENT_LENGTH_INVALID");
  });

  it("rejects a chunked body that crosses the limit even without content-length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(100)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const streamed = new Request("https://agentgrid.example/api/test", {
      method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readJsonBody(streamed, 32)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("rejects invalid UTF-8, malformed JSON, and empty bodies", async () => {
    await expect(readJsonBody(request(new Uint8Array([0xff])))).rejects.toThrow("JSON_BODY_INVALID_UTF8");
    await expect(readJsonBody(request("{"))).rejects.toThrow("INVALID_JSON_BODY");
    await expect(readJsonBody(request(""))).rejects.toThrow("INVALID_JSON_BODY");
  });

  it("streams bounded binary uploads without trusting content length", async () => {
    const accepted = request(new Uint8Array([1, 2, 3]), { "content-type": "application/octet-stream" });
    await expect(readBinaryBody(accepted, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(3));
        controller.close();
      },
    });
    const oversized = new Request("https://agentgrid.example/api/upload", {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: stream, duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readBinaryBody(oversized, 5)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("rejects unsupported binary media types and declared oversize uploads", async () => {
    await expect(readBinaryBody(request(new Uint8Array([1]), { "content-type": "application/gzip" }), 10)).rejects.toThrow("BINARY_CONTENT_TYPE_REQUIRED");
    await expect(readBinaryBody(request(new Uint8Array([1]), {
      "content-type": "application/octet-stream", "content-length": "11",
    }), 10)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });
});
