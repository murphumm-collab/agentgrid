import { createCipheriv, createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createClient } from "redis";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SignJWT } from "jose";
import { formatUnits, toFunctionSelector } from "viem";

const workspace = process.cwd();
const baseDatabaseUrl = process.env.AGENT_DELIVERY_SMOKE_DATABASE_URL
  ?? "postgresql://agentgrid:local-agentgrid-password@127.0.0.1:5432/agentgrid";
const redisUrl = process.env.AGENT_DELIVERY_SMOKE_REDIS_URL ?? "redis://127.0.0.1:6379/12";
const apiKey = `amp_smoke_${randomBytes(24).toString("base64url")}`;
const agentId = `delivery-smoke-${randomUUID()}`;
const owner = "0x1111111111111111111111111111111111111111";
const publisher = "0x9999999999999999999999999999999999999999";
const contractAddress = "0x2222222222222222222222222222222222222222";
const taskId = "42";
const positionId = "1";
const smokeSuffix = randomBytes(8).toString("hex");
const schema = `agent_delivery_smoke_${smokeSuffix}`;
const databaseRole = `agent_delivery_role_${smokeSuffix}`;
const databasePassword = `runtime-db-${randomBytes(24).toString("base64url")}`;
const s3AccessKey = `delivery-smoke-${smokeSuffix}`;
const s3SecretKey = `runtime-s3-${randomBytes(32).toString("base64url")}`;
const localMinioRootAccess = process.env.AGENT_DELIVERY_SMOKE_MINIO_ROOT_ACCESS ?? "agentgrid";
const localMinioRootSecret = process.env.AGENT_DELIVERY_SMOKE_MINIO_ROOT_SECRET ?? "local-agentgrid-storage-password";
const artifactMasterKey = randomBytes(32).toString("hex");
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function quantity(value: bigint) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function jsonRpcResult(request: { id?: string | number | null; method?: string; params?: unknown[] }) {
  if (request.method === "eth_chainId") return "0x61";
  if (request.method === "eth_blockNumber") return "0x1";
  if (request.method === "eth_getCode") return "0x6000";
  if (request.method !== "eth_call") throw new Error(`UNSUPPORTED_RPC_METHOD_${request.method}`);
  const call = request.params?.[0] as { data?: string } | undefined;
  const selector = call?.data?.slice(0, 10);
  if (selector === toFunctionSelector("agentPosition(address)")) return quantity(1n);
  if (selector === toFunctionSelector("isEligible(address)")) return quantity(1n);
  if (selector === toFunctionSelector("agentCapabilities(address)")) return quantity(1n);
  if (selector === toFunctionSelector("stakeOf(uint256)")) return quantity(1_500n * 10n ** 18n);
  throw new Error(`UNSUPPORTED_ETH_CALL_${selector}`);
}

async function rpcServer() {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(body) as { id?: string | number | null; method?: string; params?: unknown[] };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? null, result: jsonRpcResult(parsed) }));
      } catch (error) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: error instanceof Error ? error.message : "RPC_ERROR" } }));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("RPC_SMOKE_ADDRESS_UNAVAILABLE");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("WEB_SMOKE_ADDRESS_UNAVAILABLE");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function minioAdmin(script: string, input: string) {
  const child = spawn("docker", ["compose", "exec", "-T", "minio", "sh", "-c", script], {
    cwd: workspace, stdio: ["pipe", "ignore", "pipe"],
  });
  let error = "";
  child.stderr?.on("data", (chunk) => { error += String(chunk); });
  child.stdin?.end(input);
  const [code] = await once(child, "exit") as [number | null];
  if (code !== 0) throw new Error(`MINIO_ADMIN_FAILED_${code}_${error}`);
}

async function waitForLive(baseUrl: string, child: ChildProcess, output: () => string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`WEB_PROCESS_EXITED_${child.exitCode}_${output()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health/live`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* The new process has not bound the port yet. */ }
    await sleep(100);
  }
  throw new Error(`WEB_PROCESS_NOT_READY_${output()}`);
}

async function stopWeb(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGKILL");
  await once(child, "exit");
}

async function postJson<T>(baseUrl: string, route: string, body: unknown) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-key": apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(`HTTP_${response.status}_${route}_${payload.error ?? "UNKNOWN"}`);
  return payload;
}

async function expectBodyPolicyError(response: Response, status: number, error: string) {
  const payload = await response.json() as { error?: string };
  if (response.status !== status || payload.error !== error) {
    throw new Error(`DELIVERY_SMOKE_BODY_POLICY_${response.status}_${payload.error ?? "UNKNOWN"}`);
  }
}

async function verifyJsonBodyPolicy(baseUrl: string) {
  await expectBodyPolicyError(await fetch(`${baseUrl}/api/agent/jobs/lease`, {
    method: "POST", headers: { "content-type": "text/plain" }, body: "{}", signal: AbortSignal.timeout(10_000),
  }), 415, "JSON_CONTENT_TYPE_REQUIRED");
  await expectBodyPolicyError(await fetch(`${baseUrl}/api/agent/jobs/lease`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{", signal: AbortSignal.timeout(10_000),
  }), 400, "INVALID_JSON_BODY");
  const oversizedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`{"padding":"${"x".repeat(40_000)}`));
      controller.enqueue(encoder.encode(`${"x".repeat(40_000)}"}`));
      controller.close();
    },
  });
  const request = new Request(`${baseUrl}/api/agent/jobs/lease`, {
    method: "POST", headers: { "content-type": "application/json" }, body: oversizedStream, duplex: "half",
    signal: AbortSignal.timeout(10_000),
  } as RequestInit & { duplex: "half" });
  await expectBodyPolicyError(await fetch(request), 413, "REQUEST_BODY_TOO_LARGE");
}

async function verifyBinaryBodyPolicy(baseUrl: string, manifestId: string, authSecret: string) {
  const session = await new SignJWT({ address: publisher, chainId: 97 })
    .setProtectedHeader({ alg: "HS256" }).setSubject(publisher.toLowerCase()).setIssuedAt().setExpirationTime("10m")
    .setIssuer("agentgrid").setAudience("agentgrid-web").sign(new TextEncoder().encode(authSecret));
  const headers = {
    origin: baseUrl, cookie: `agentgrid-session=${session}`, "x-publisher": publisher,
    "content-type": "application/octet-stream",
  };
  const oversizedStream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); controller.close(); },
  });
  const request = new Request(`${baseUrl}/api/hidden-tests/${manifestId}/content`, {
    method: "PUT", headers, body: oversizedStream, duplex: "half", signal: AbortSignal.timeout(10_000),
  } as RequestInit & { duplex: "half" });
  await expectBodyPolicyError(await fetch(request), 413, "REQUEST_BODY_TOO_LARGE");
}

async function main() {
  const admin = new Pool({ connectionString: baseDatabaseUrl, max: 1 });
  const redis = createClient({ url: redisUrl });
  const rpc = await rpcServer();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const isolatedDatabaseUrl = new URL(baseDatabaseUrl);
  isolatedDatabaseUrl.username = databaseRole;
  isolatedDatabaseUrl.password = databasePassword;
  isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
  const secretFolder = mkdtempSync(path.join(tmpdir(), "agentgrid-delivery-secrets-"));
  const secretValues: Record<string, string> = {
    DATABASE_URL: isolatedDatabaseUrl.toString(),
    AUTH_SECRET: `runtime-auth-${randomBytes(32).toString("hex")}`,
    S3_ACCESS_KEY: s3AccessKey,
    S3_SECRET_KEY: s3SecretKey,
    ARTIFACT_MASTER_KEY: artifactMasterKey,
    ADMIN_API_KEY: `runtime-admin-${randomBytes(32).toString("hex")}`,
    ALERT_WEBHOOK_SECRET: `runtime-alert-${randomBytes(32).toString("hex")}`,
  };
  const secretFiles = Object.fromEntries(Object.entries(secretValues).map(([name, value]) => {
    const filename = path.join(secretFolder, name.toLowerCase());
    writeFileSync(filename, `${value}\n`, { mode: 0o400 });
    chmodSync(filename, 0o400);
    return [name, filename];
  }));
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PROTOCOL_MODE: "production",
    REQUIRE_FILE_SECRETS: "true",
    DATABASE_URL_FILE: secretFiles.DATABASE_URL,
    REDIS_URL: redisUrl,
    AGENT_LEASE_SECONDS: "15",
    AUTH_SECRET_FILE: secretFiles.AUTH_SECRET,
    AUTH_ORIGIN: baseUrl,
    ARTIFACT_MASTER_KEY_FILE: secretFiles.ARTIFACT_MASTER_KEY,
    ADMIN_API_KEY_FILE: secretFiles.ADMIN_API_KEY,
    ALERT_WEBHOOK_URL: "https://alerts.invalid/agentgrid-smoke",
    ALERT_WEBHOOK_SECRET_FILE: secretFiles.ALERT_WEBHOOK_SECRET,
    S3_ENDPOINT: "http://127.0.0.1:9000",
    S3_REGION: "us-east-1",
    S3_BUCKET: "agentgrid-artifacts",
    S3_ACCESS_KEY_FILE: secretFiles.S3_ACCESS_KEY,
    S3_SECRET_KEY_FILE: secretFiles.S3_SECRET_KEY,
    BSC_TESTNET_RPC_URL: rpc.url,
    BSC_CHAIN_ID: "97",
    CHAIN_CONFIRMATIONS: "5",
    WALLETCONNECT_PROJECT_ID: "delivery-smoke-walletconnect-project",
    TOKEN_ADDRESS: contractAddress,
    STAKE_MANAGER_ADDRESS: contractAddress,
    AGENT_REGISTRY_ADDRESS: contractAddress,
    TASK_REGISTRY_ADDRESS: contractAddress,
    REWARD_VAULT_ADDRESS: contractAddress,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
  };
  for (const name of Object.keys(secretValues)) {
    delete childEnvironment[name];
    delete process.env[name];
  }
  Object.assign(process.env, childEnvironment);
  let web: ChildProcess | undefined;
  let webOutput = "";
  let store: typeof import("../src/lib/store-postgres") | undefined;
  let queue: typeof import("../src/lib/agent-queue") | undefined;
  let minioUserCreated = false;
  const createdObjectKeys: string[] = [];

  const startWeb = async () => {
    webOutput = "";
    const child = spawn(process.execPath, ["server.js"], {
      cwd: path.join(workspace, ".next", "standalone"),
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => { webOutput += String(chunk); });
    child.stderr?.on("data", (chunk) => { webOutput += String(chunk); });
    await waitForLive(baseUrl, child, () => webOutput.slice(-2_000));
    return child;
  };

  try {
    await admin.query(`CREATE ROLE ${databaseRole} LOGIN PASSWORD '${databasePassword}'`);
    await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${databaseRole}`);
    await minioAdmin('IFS= read -r root_access; IFS= read -r root_secret; IFS= read -r access; IFS= read -r secret; mc alias set agentgrid-smoke http://127.0.0.1:9000 "$root_access" "$root_secret" >/dev/null; mc admin user add agentgrid-smoke "$access" "$secret"; mc admin policy attach agentgrid-smoke readwrite --user "$access"; mc alias rm agentgrid-smoke >/dev/null', `${localMinioRootAccess}\n${localMinioRootSecret}\n${s3AccessKey}\n${s3SecretKey}\n`);
    minioUserCreated = true;
    await redis.connect();
    await redis.flushDb();
    store = await import("../src/lib/store-postgres");
    queue = await import("../src/lib/agent-queue");
    const { updateDatabase } = await import("../src/lib/store");
    await store.migratePostgres();
    const binaryLimitManifestId = randomUUID();
    await store.createHiddenTestManifest({
      id: binaryLimitManifestId, publisher, objectKey: `hidden-tests/${publisher.toLowerCase()}/${binaryLimitManifestId}`,
      sha256: "11".repeat(32), plaintextSha256: "22".repeat(32), sizeBytes: 8, contentType: "application/gzip",
      encryptionAlgorithm: "AES-256-GCM", contentIv: randomBytes(12).toString("base64"),
      sealedKey: randomBytes(32).toString("base64"), sealIv: randomBytes(12).toString("base64"), sealTag: randomBytes(16).toString("base64"),
    });
    const salt = randomBytes(16).toString("hex");
    await updateDatabase((database) => {
      database.agents.push({
        id: agentId, name: "Delivery integration executor", owner, role: "EXECUTOR",
        capabilities: ["typescript", "testing"], endpoint: baseUrl, stake: 1_500,
        stakePositionId: positionId, scopes: ["tasks:claim", "tasks:submit", "heartbeat:write"],
        apiKeyHash: scryptSync(apiKey, salt, 32).toString("hex"), apiKeySalt: salt,
        revokedAt: null, reputation: 80, completedTasks: 0, online: true,
      });
    });
    const specHash = `0x${"ab".repeat(32)}`;
    const db = new Pool({ connectionString: isolatedDatabaseUrl.toString(), max: 1 });
    await db.query(
      `INSERT INTO task_commitments(id,publisher,spec_hash,spec,status)
       VALUES($1,$2,$3,$4::jsonb,'APPROVED')`,
      [randomUUID(), publisher, specHash, JSON.stringify({
        title: "Recover an encrypted delivery across Web process crashes",
        description: "Integration smoke task proving durable Agent lease and encrypted artifact finalization across independent Web process restarts.",
        category: "Development", executionMode: "COLLABORATION", maxExecutors: 1,
        declaredDurationHours: 1, criteria: ["Encrypted artifact survives API process restart"],
      })],
    );
    await db.end();
    await store.chainCursor(`delivery-smoke-${schema}`, 1n);
    const transactionHash = `0x${"cd".repeat(32)}`;
    const blockHash = `0x${"ef".repeat(32)}`;
    await store.persistChainBatch(`delivery-smoke-${schema}`, 1n, 2n, blockHash, [
      { chainId: 97, transactionHash, logIndex: 0, blockNumber: 1n, blockHash, address: contractAddress, topics: [], data: "0x", eventName: "TaskCreated", eventArgs: { taskId, publisher, positionId: "99", specHash } },
      { chainId: 97, transactionHash, logIndex: 1, blockNumber: 1n, blockHash, address: contractAddress, topics: [], data: "0x", eventName: "TaskClaimed", eventArgs: { taskId, executor: owner } },
    ]);
    if (await queue.dispatchJobOutbox() !== 1) throw new Error("DELIVERY_SMOKE_OUTBOX_NOT_DISPATCHED");

    web = await startWeb();
    const readinessResponse = await fetch(`${baseUrl}/api/health/ready`, { signal: AbortSignal.timeout(10_000) });
    const readiness = await readinessResponse.json() as { checks?: Record<string, boolean> };
    if (!readinessResponse.ok || readiness.checks?.fileBackedSecrets !== true) throw new Error("DELIVERY_SMOKE_FILE_SECRET_READINESS_FAILED");
    const chainConfigResponse = await fetch(`${baseUrl}/api/chain/config`, { signal: AbortSignal.timeout(10_000) });
    const chainConfig = await chainConfigResponse.json() as { chainId?: number; confirmations?: number; walletConnectProjectId?: string; contracts?: Record<string, string> };
    if (
      !chainConfigResponse.ok || chainConfig.chainId !== 97 || chainConfig.confirmations !== 5 ||
      chainConfig.walletConnectProjectId !== "delivery-smoke-walletconnect-project" ||
      Object.values(chainConfig.contracts ?? {}).length !== 5 ||
      Object.values(chainConfig.contracts ?? {}).some((address) => address.toLowerCase() !== contractAddress)
    ) throw new Error("DELIVERY_SMOKE_RUNTIME_BROWSER_CHAIN_CONFIG_FAILED");
    await verifyJsonBodyPolicy(baseUrl);
    await verifyBinaryBodyPolicy(baseUrl, binaryLimitManifestId, secretValues.AUTH_SECRET);
    const firstLease = await postJson<{ job: { id: string }; leaseSeconds: number } | null>(baseUrl, "/api/agent/jobs/lease", { agentId, role: "EXECUTOR" });
    if (!firstLease?.job?.id) throw new Error("DELIVERY_SMOKE_FIRST_LEASE_MISSING");
    const jobId = firstLease.job.id;
    await stopWeb(web);
    web = undefined;

    web = await startWeb();
    await sleep((firstLease.leaseSeconds + 1) * 1_000);
    const recovered = await postJson<{ job: { id: string }; leaseSeconds: number } | null>(baseUrl, "/api/agent/jobs/lease", { agentId, role: "EXECUTOR" });
    if (recovered?.job?.id !== jobId) throw new Error("DELIVERY_SMOKE_JOB_NOT_RECOVERED_AFTER_PROCESS_CRASH");

    const { buildAgentProjectArchive } = await import("../src/lib/agent-artifact-builder");
    const plaintext = Buffer.from(await buildAgentProjectArchive({
      summary: "Crash-recoverable encrypted integration smoke artifact",
      files: [
        { path: "package.json", content: JSON.stringify({ type: "module", scripts: { test: "node --test" } }) },
        { path: "src/index.js", content: "export const recovered = true;\n" },
        { path: "test/index.test.mjs", content: "import assert from 'node:assert/strict'; import { recovered } from '../src/index.js'; assert.equal(recovered, true);\n" },
      ],
    }));
    const encryptionKey = randomBytes(32);
    const contentIv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, contentIv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const sha256 = createHash("sha256").update(ciphertext).digest("hex");
    const plaintextSha256 = createHash("sha256").update(plaintext).digest("hex");
    const upload = await postJson<{ id: string; objectKey: string; uploadUrl: string; headers: Record<string, string> }>(baseUrl, "/api/artifacts/uploads", {
      taskId, agentId, sha256, sizeBytes: ciphertext.length, contentType: "application/gzip",
      plaintextSha256, encryptionAlgorithm: "AES-256-GCM", contentIv: contentIv.toString("base64"),
      encryptionKey: encryptionKey.toString("base64"),
    });
    createdObjectKeys.push(upload.objectKey);

    await stopWeb(web);
    web = undefined;
    const uploadResponse = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: ciphertext, signal: AbortSignal.timeout(10_000) });
    if (!uploadResponse.ok) throw new Error(`DELIVERY_SMOKE_ARTIFACT_UPLOAD_FAILED_${uploadResponse.status}`);
    web = await startWeb();
    await postJson(baseUrl, `/api/agent/jobs/${encodeURIComponent(jobId)}/heartbeat`, { agentId });
    const finalized = await postJson<{ artifactHash: string; artifactUrl: string }>(baseUrl, `/api/artifacts/${encodeURIComponent(upload.id)}/finalize`, { agentId });
    if (finalized.artifactHash !== `sha256:${plaintextSha256}` || !finalized.artifactUrl.startsWith("s3://")) throw new Error("DELIVERY_SMOKE_FINALIZED_ARTIFACT_INVALID");
    createdObjectKeys.push(finalized.artifactUrl.split("/").slice(3).join("/"));
    await postJson(baseUrl, `/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, { agentId, result: { artifactHash: finalized.artifactHash } });

    const completedAgain = await fetch(`${baseUrl}/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-key": apiKey },
      body: JSON.stringify({ agentId, result: { duplicate: true } }), signal: AbortSignal.timeout(10_000),
    });
    if (completedAgain.ok) throw new Error("DELIVERY_SMOKE_DUPLICATE_COMPLETION_ACCEPTED");
    const manifest = await store.artifactManifest(upload.id, agentId);
    if (manifest.status !== "READY") throw new Error("DELIVERY_SMOKE_ARTIFACT_NOT_DURABLE");
    console.log(JSON.stringify({
      isolatedSchema: true,
      webProcessCrashRecovered: true,
      sameJobRecovered: recovered.job.id === jobId,
      artifactManifestSurvivedRestart: true,
      encryptedArtifactVerifiedAndSealed: true,
      duplicateCompletionRejected: true,
      fileBackedReadiness: true,
      runtimeBrowserChainConfig: true,
      browserTransactionConfirmations: chainConfig.confirmations,
      boundedJsonRequests: true,
      chunkedBodyLimitEnforced: true,
      binaryUploadLimitEnforced: true,
      onchainStakeMockTokens: Number(formatUnits(1_500n * 10n ** 18n, 18)),
    }));
  } finally {
    if (web) await stopWeb(web).catch(() => undefined);
    if (queue) await queue.closeRedisForTests().catch(() => undefined);
    if (store) await store.closePostgresForTests().catch(() => undefined);
    if (redis.isOpen) { await redis.flushDb().catch(() => undefined); await redis.close().catch(() => undefined); }
    const s3 = new S3Client({ endpoint: "http://127.0.0.1:9000", region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey } });
    for (const key of createdObjectKeys.filter(Boolean)) await s3.send(new DeleteObjectCommand({ Bucket: "agentgrid-artifacts", Key: key })).catch(() => undefined);
    if (minioUserCreated) await minioAdmin('IFS= read -r root_access; IFS= read -r root_secret; IFS= read -r access; mc alias set agentgrid-smoke http://127.0.0.1:9000 "$root_access" "$root_secret" >/dev/null; mc admin user remove agentgrid-smoke "$access"; mc alias rm agentgrid-smoke >/dev/null', `${localMinioRootAccess}\n${localMinioRootSecret}\n${s3AccessKey}\n`).catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${databaseRole}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    await closeServer(rpc.server).catch(() => undefined);
    rmSync(secretFolder, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
