import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { isProductionMode, runtimeConfig } from "./env";
import { appendAuditEvent, consumePostgresRateLimit } from "./store-postgres";

const demoWindows = new Map<string, { start: number; count: number }>();

export function requestId(request: Request) {
  return request.headers.get("x-request-id")?.slice(0, 128) || randomUUID();
}

export function requestClientKey(request: Request) {
  const config = runtimeConfig();
  let raw = "untrusted-direct";
  if (config.TRUST_PROXY) {
    const configured = Buffer.from(config.TRUSTED_PROXY_SHARED_SECRET ?? "");
    const supplied = Buffer.from(request.headers.get("x-agentgrid-proxy-auth") ?? "");
    if (configured.length < 32 || supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new Error("TRUSTED_PROXY_AUTHENTICATION_REQUIRED");
    }
    const forwarded = request.headers.get("x-forwarded-for")?.trim() ?? "";
    if (forwarded.includes(",") || isIP(forwarded) === 0) throw new Error("TRUSTED_PROXY_CLIENT_IP_INVALID");
    raw = forwarded;
  }
  return createHash("sha256").update(raw).digest("hex");
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const allowed = isProductionMode() ? await consumePostgresRateLimit(key, limit, windowSeconds) : consumeDemoLimit(key, limit, windowSeconds);
  if (!allowed) throw new Error("RATE_LIMIT_EXCEEDED");
}

function consumeDemoLimit(key: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const current = demoWindows.get(key);
  if (!current || current.start + windowSeconds * 1_000 < now) {
    demoWindows.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

export async function audit(input: { actor: string; action: string; target?: string; requestId?: string; payload?: unknown }) {
  if (isProductionMode()) await appendAuditEvent(input);
  else console.info(JSON.stringify({ level: "audit", ...input, at: new Date().toISOString() }));
}
