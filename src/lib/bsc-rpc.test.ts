import { afterEach, describe, expect, it, vi } from "vitest";
import { bscRpcResult, bscRpcTransport, validatedBscRpcUrl } from "./bsc-rpc";

afterEach(() => vi.unstubAllGlobals());

describe("BSC RPC trust boundary", () => {
  it("requires HTTPS remotely and rejects embedded credentials and fragments", () => {
    expect(validatedBscRpcUrl("https://rpc.example/v1/key?network=testnet")).toBe("https://rpc.example/v1/key?network=testnet");
    expect(validatedBscRpcUrl("http://127.0.0.1:8545")).toBe("http://127.0.0.1:8545/");
    expect(() => validatedBscRpcUrl("http://rpc.example")).toThrow("BSC_RPC_HTTPS_REQUIRED");
    expect(() => validatedBscRpcUrl("https://user:secret@rpc.example")).toThrow("BSC_RPC_URL_CREDENTIALS_FORBIDDEN");
    expect(() => validatedBscRpcUrl("https://rpc.example/#secret")).toThrow("BSC_RPC_URL_FRAGMENT_FORBIDDEN");
  });

  it("builds a bounded, redirect-rejecting viem transport", () => {
    const transport = bscRpcTransport("https://rpc.example");
    const configured = transport({ chain: undefined, retryCount: 0, timeout: 0 });
    expect(configured.config.retryCount).toBe(2);
    expect(configured.value?.fetchOptions).toMatchObject({ redirect: "error" });
  });

  it("returns a bounded JSON-RPC result with timeout and redirect protection", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ jsonrpc: "2.0", id: "eth_chainId", result: "0x61" });
    }));
    await expect(bscRpcResult("https://rpc.example", "eth_chainId")).resolves.toBe("0x61");
  });

  it("stops oversized chunked RPC responses before JSON parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array([1])); controller.close(); },
    }))));
    await expect(bscRpcResult("https://rpc.example", "eth_chainId")).rejects.toThrow("BSC_RPC_RESPONSE_TOO_LARGE");
  });
});
