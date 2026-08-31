import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { runtimeSecretNames } from "../src/lib/secrets";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("PROXY_SMOKE_PORT_INVALID");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForLive(origin: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`PROXY_SMOKE_ORIGIN_EXITED_${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/health/live`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* keep waiting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("PROXY_SMOKE_ORIGIN_START_TIMEOUT");
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3_000)),
  ]);
}

async function main() {
  const originPort = await freePort();
  const edgePort = await freePort();
  const folder = mkdtempSync(path.join(tmpdir(), "agentgrid-proxy-smoke-"));
  const secretValues = {
    DATABASE_URL: "postgresql://agentgrid:unused@127.0.0.1:5432/agentgrid",
    AUTH_SECRET: `proxy-smoke-auth-${randomBytes(32).toString("hex")}`,
    ADMIN_API_KEY: `proxy-smoke-admin-${randomBytes(32).toString("hex")}`,
    TRUSTED_PROXY_SHARED_SECRET: `proxy-smoke-edge-${randomBytes(32).toString("hex")}`,
  };
  const files = Object.fromEntries(Object.entries(secretValues).map(([name, value]) => {
    const filename = path.join(folder, name.toLowerCase());
    writeFileSync(filename, `${value}\n`, { mode: 0o400 });
    chmodSync(filename, 0o400);
    return [name, filename];
  }));
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PROTOCOL_MODE: "production",
    REQUIRE_FILE_SECRETS: "true",
    TRUST_PROXY: "true",
    PORT: String(originPort),
    HOSTNAME: "127.0.0.1",
  };
  for (const name of runtimeSecretNames) {
    delete childEnvironment[name];
    delete childEnvironment[`${name}_FILE`];
  }
  childEnvironment.DATABASE_URL_FILE = files.DATABASE_URL;
  childEnvironment.AUTH_SECRET_FILE = files.AUTH_SECRET;
  childEnvironment.ADMIN_API_KEY_FILE = files.ADMIN_API_KEY;
  childEnvironment.TRUSTED_PROXY_SHARED_SECRET_FILE = files.TRUSTED_PROXY_SHARED_SECRET;
  const child = spawn(process.execPath, [path.join(process.cwd(), ".next", "standalone", "server.js")], {
    cwd: path.join(process.cwd(), ".next", "standalone"),
    env: childEnvironment,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    if (Buffer.byteLength(stderr) < 64 * 1024) stderr += String(chunk).slice(0, 64 * 1024 - Buffer.byteLength(stderr));
  });
  const origin = `http://127.0.0.1:${originPort}`;
  const edge = http.createServer((incoming, outgoing) => {
    const headers = { ...incoming.headers };
    delete headers["x-forwarded-for"];
    delete headers["x-real-ip"];
    delete headers["x-agentgrid-proxy-auth"];
    headers["x-forwarded-for"] = incoming.socket.remoteAddress?.replace(/^::ffff:/, "") || "127.0.0.1";
    headers["x-agentgrid-proxy-auth"] = secretValues.TRUSTED_PROXY_SHARED_SECRET;
    const proxied = http.request({
      hostname: "127.0.0.1", port: originPort, path: incoming.url, method: incoming.method, headers,
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    proxied.on("error", () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(proxied);
  });
  try {
    await waitForLive(origin, child);
    await new Promise<void>((resolve, reject) => {
      edge.once("error", reject);
      edge.listen(edgePort, "127.0.0.1", () => resolve());
    });
    const authorization = `Bearer ${secretValues.ADMIN_API_KEY}`;
    const probe = async (forwarded: string) => {
      const response = await fetch(`http://127.0.0.1:${edgePort}/api/admin/edge-probe`, {
        headers: { authorization, "x-forwarded-for": forwarded, "x-agentgrid-proxy-auth": "attacker-value" },
      });
      assert(response.status === 200, `PROXY_SMOKE_EDGE_STATUS_${response.status}`);
      return response.json() as Promise<{ trustedProxy: boolean; clientKey: string }>;
    };
    const [first, second] = await Promise.all([probe("203.0.113.11"), probe("198.51.100.22, 10.0.0.1")]);
    const expectedKey = createHash("sha256").update("127.0.0.1").digest("hex");
    assert(first.trustedProxy && second.trustedProxy, "PROXY_SMOKE_TRUST_DISABLED");
    assert(first.clientKey === expectedKey && second.clientKey === expectedKey, "PROXY_SMOKE_SPOOF_NOT_OVERWRITTEN");

    const direct = await fetch(`${origin}/api/admin/edge-probe`, {
      headers: { authorization, "x-forwarded-for": "203.0.113.99" },
    });
    assert(direct.status === 401, `PROXY_SMOKE_DIRECT_STATUS_${direct.status}`);
    const directBody = await direct.json() as { error?: string };
    assert(directBody.error === "TRUSTED_PROXY_AUTHENTICATION_REQUIRED", "PROXY_SMOKE_DIRECT_ERROR_INVALID");
    console.log(JSON.stringify({
      trustedProxySmoke: true,
      spoofedForwardedForOverwritten: true,
      authenticatedProxyHeaderRequired: true,
      directOriginWithoutProxyRejected: true,
      originPort: "ephemeral",
      edgePort: "ephemeral",
    }));
  } finally {
    if (edge.listening) await new Promise<void>((resolve) => edge.close(() => resolve()));
    await stop(child);
    rmSync(folder, { recursive: true, force: true });
    if (child.exitCode && child.exitCode !== 0 && child.signalCode !== "SIGTERM") throw new Error(`PROXY_SMOKE_ORIGIN_FAILED_${child.exitCode}_${stderr}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TRUSTED_PROXY_SMOKE_FAILED");
  process.exitCode = 1;
});
