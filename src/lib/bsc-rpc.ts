import { http } from "viem";
import { readBoundedResponseText } from "./outbound-response";

const maximumRpcResponseBytes = 1024 * 1024;

function loopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function validatedBscRpcUrl(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error("BSC_RPC_URL_CREDENTIALS_FORBIDDEN");
  if (url.hash) throw new Error("BSC_RPC_URL_FRAGMENT_FORBIDDEN");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname.toLowerCase()))) {
    throw new Error("BSC_RPC_HTTPS_REQUIRED");
  }
  return url.toString();
}

export function bscRpcTransport(raw: string) {
  return http(validatedBscRpcUrl(raw), {
    timeout: 10_000,
    retryCount: 2,
    maxResponseBodySize: maximumRpcResponseBytes,
    fetchOptions: { redirect: "error" },
  });
}

export async function bscRpcResult(raw: string, method: string, params: unknown[] = [], timeoutMs = 3_000) {
  const response = await fetch(validatedBscRpcUrl(raw), {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("BSC_RPC_FAILED");
  const text = await readBoundedResponseText(response, maximumRpcResponseBytes, {
    missingBody: "BSC_RPC_EMPTY_RESPONSE",
    tooLarge: "BSC_RPC_RESPONSE_TOO_LARGE",
    invalidContentLength: "BSC_RPC_INVALID_CONTENT_LENGTH",
    invalidUtf8: "BSC_RPC_INVALID_UTF8",
  });
  let body: { result?: unknown; error?: unknown };
  try { body = JSON.parse(text) as typeof body; } catch { throw new Error("BSC_RPC_INVALID_JSON"); }
  if (body.error || typeof body.result !== "string") throw new Error("BSC_RPC_FAILED");
  return body.result;
}
