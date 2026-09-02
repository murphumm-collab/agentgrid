import { createCipheriv, createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createClient } from "redis";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SignJWT } from "jose";
import { formatUnits, toFunctionSelector } from "viem";
import {
  chainConfigResponseSchema,
  discoveryResponseSchema,
  leaseJobResponseSchema,
  publicAgentsResponseSchema,
  publicDashboardResponseSchema,
} from "../src/sdk/response-schemas";
import { agentJobKinds } from "../src/lib/agent-job-schema";
import { notificationsResponseSchema } from "../src/lib/wallet-workflow-schema";
import { apiErrorResponseSchema } from "../src/lib/api-error-schema";

const workspace = process.cwd();
const baseDatabaseUrl = process.env.AGENT_DELIVERY_SMOKE_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? "postgresql://agentgrid:local-agentgrid-password@127.0.0.1:5432/agentgrid";
const redisUrl = process.env.AGENT_DELIVERY_SMOKE_REDIS_URL
  ?? process.env.REDIS_URL
  ?? "redis://127.0.0.1:6379/12";
const s3Endpoint = process.env.AGENT_DELIVERY_SMOKE_S3_ENDPOINT
  ?? process.env.S3_ENDPOINT
  ?? "http://127.0.0.1:9000";
const apiKey = `amp_smoke_${randomBytes(24).toString("base64url")}`;
const agentId = `delivery-smoke-${randomUUID()}`;
const hiddenManagementAgentId = `private-management-${randomUUID()}`;
const hiddenManagementTimestamp = "2042-01-02T03:04:05.678Z";
const hiddenManagementEndpoint = "https://private-management.invalid/jobs";
const owner = "0x1111111111111111111111111111111111111111";
const publisher = "0x9999999999999999999999999999999999999999";
const contractAddresses = {
  token: "0x2222222222222222222222222222222222222221",
  stakeManager: "0x2222222222222222222222222222222222222222",
  agentRegistry: "0x2222222222222222222222222222222222222223",
  rewardVault: "0x2222222222222222222222222222222222222224",
  taskRegistry: "0x2222222222222222222222222222222222222225",
  disputeResolver: "0x2222222222222222222222222222222222222226",
  verificationPanel: "0x2222222222222222222222222222222222222227",
  verificationArbitrationCourt: "0x2222222222222222222222222222222222222228",
  protocolEconomics: "0x2222222222222222222222222222222222222229",
  competitionSlotPassRegistry: "0x2222222222222222222222222222222222222230",
} as const;
const contractAddress = contractAddresses.taskRegistry;
const taskId = "42";
const positionId = "1";
let mockAgentActive = true;
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

function jsonRpcResult(request: { id?: string | number | null; method?: string; params?: unknown[] }, runtimeCodes: Record<string, string>) {
  if (request.method === "eth_chainId") return "0x61";
  if (request.method === "eth_blockNumber") return "0x1";
  if (request.method === "eth_getCode") return runtimeCodes[String(request.params?.[0] ?? "").toLowerCase()] ?? "0x";
  if (request.method === "eth_getLogs") return [];
  if (request.method === "eth_getTransactionReceipt") return {
    transactionHash: String(request.params?.[0]), transactionIndex: "0x0", blockHash: `0x${"55".repeat(32)}`, blockNumber: "0x1",
    from: publisher, to: contractAddress, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", contractAddress: null,
    logs: [], logsBloom: `0x${"00".repeat(256)}`, status: "0x0", effectiveGasPrice: "0x1", type: "0x2",
  };
  if (request.method !== "eth_call") throw new Error(`UNSUPPORTED_RPC_METHOD_${request.method}`);
  const call = request.params?.[0] as { data?: string } | undefined;
  const selector = call?.data?.slice(0, 10);
  if (selector === toFunctionSelector("agentPosition(address)")) return quantity(1n);
  if (selector === toFunctionSelector("agentActive(address)")) return quantity(mockAgentActive ? 1n : 0n);
  if (selector === toFunctionSelector("isEligible(address)")) return quantity(1n);
  if (selector === toFunctionSelector("agentCapabilities(address)")) return quantity(1n);
  if (selector === toFunctionSelector("stakeOf(uint256)")) return quantity(1_500n * 10n ** 18n);
  throw new Error(`UNSUPPORTED_ETH_CALL_${selector}`);
}

async function rpcServer(runtimeCodes: Record<string, string>) {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(body) as { id?: string | number | null; method?: string; params?: unknown[] };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? null, result: jsonRpcResult(parsed, runtimeCodes) }));
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

async function specAssistantAiServer() {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(body) as { messages?: Array<{ content?: string }> };
        const role = parsed.messages?.[0]?.content?.includes("VALIDATION_CRITIC") ? "VALIDATION_CRITIC" : "REQUIREMENTS_WRITER";
        const review = {
          role,
          summary: `${role} independently checked the business outcome and every verifier-controlled pass condition.`,
          clarifyingQuestions: [],
          risks: ["Post-publication scope changes require a new commitment."],
          suggestedTargetUsers: "Settlement operations owners who approve the monitored workflow",
          suggestedDeliverables: ["Runnable monitored service archive", "Operator verification and rollback runbook"],
          suggestedConstraints: ["No production credentials and no outbound network during independent verification"],
          suggestedOutOfScope: ["Mainnet deployment and requirements introduced after publication"],
          suggestedAssumptions: ["Input events follow the committed JSON schema"],
          suggestedCriteria: [
            { description: "The service builds and all sealed tests pass", verificationMethod: "Run the fixed build and sealed test commands in the protocol sandbox", evidenceRequired: "Tester-signed exit codes, test manifest hash and artifact hash", passCondition: "Build exit code equals 0 and failed test count equals 0", verificationType: "AUTOMATED_TEST", required: true },
            { description: "Critical branch coverage meets the committed threshold", verificationMethod: "Run verifier-owned coverage collection against every delivered source module", evidenceRequired: "Tester-signed coverage metrics and artifact hash", passCondition: "Critical branch coverage is greater than or equal to 95%", verificationType: "AUTOMATED_TEST", required: true },
          ],
        };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(review) } }] }));
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "INVALID_AI_REQUEST" }));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SPEC_ASSISTANT_AI_SMOKE_ADDRESS_UNAVAILABLE");
  return { server, url: `http://127.0.0.1:${address.port}/v1` };
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

async function verifyPackagedAiFrontend(baseUrl: string, secretValues: Record<string, string>) {
  const routes = ["/dashboard", "/agents", "/api/agents", "/api/public/dashboard", "/openapi.json", "/.well-known/agentgrid.json"] as const;
  const responses = await Promise.all(routes.map(async (route) => {
    const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const body = await response.text();
    if (!response.ok) throw new Error(`DELIVERY_SMOKE_PACKAGED_FRONTEND_${route}_${response.status}`);
    return [route, body] as const;
  }));
  const bodies = Object.fromEntries(responses) as Record<(typeof routes)[number], string>;
  if (!bodies["/dashboard"].includes("AI OPERATIONS DASHBOARD")) {
    throw new Error("DELIVERY_SMOKE_AI_DASHBOARD_HTML_MISSING");
  }
  if (!bodies["/agents"].includes("Connect and sign in with the current BSC wallet")
    || bodies["/agents"].includes("Credential recovery")
    || bodies["/agents"].includes(hiddenManagementTimestamp)
    || bodies["/agents"].includes(hiddenManagementEndpoint)) {
    throw new Error("DELIVERY_SMOKE_UNAUTHENTICATED_AGENT_MANAGEMENT_EXPOSED");
  }
  const agentDirectory = publicAgentsResponseSchema.parse(JSON.parse(bodies["/api/agents"]));
  const publicAgentKeys = ["capabilities", "completedTasks", "id", "name", "online", "owner", "quality", "reputation", "role", "stake"];
  if (!agentDirectory.agents?.length
    || agentDirectory.agents.some((agent) => JSON.stringify(Object.keys(agent).sort()) !== JSON.stringify(publicAgentKeys))
    || bodies["/api/agents"].includes(hiddenManagementTimestamp)
    || bodies["/api/agents"].includes(hiddenManagementEndpoint)) {
    throw new Error("DELIVERY_SMOKE_PUBLIC_AGENT_DIRECTORY_INVALID");
  }
  const ownerHeaders = await walletHeaders(baseUrl, secretValues.AUTH_SECRET, owner);
  const authenticatedAgents = await fetch(`${baseUrl}/agents`, {
    headers: ownerHeaders,
    signal: AbortSignal.timeout(10_000), cache: "no-store",
  });
  const authenticatedAgentHtml = await authenticatedAgents.text();
  if (!authenticatedAgents.ok || !authenticatedAgentHtml.includes("Credential recovery")
    || !authenticatedAgentHtml.includes(agentId)
    || authenticatedAgentHtml.includes(hiddenManagementTimestamp)
    || authenticatedAgentHtml.includes(hiddenManagementEndpoint)) {
    throw new Error("DELIVERY_SMOKE_AGENT_MANAGEMENT_OWNER_BOUNDARY_INVALID");
  }
  const unauthenticatedWalletReads = await Promise.all([
    fetch(`${baseUrl}/api/notifications`, { signal: AbortSignal.timeout(10_000), cache: "no-store" }),
    fetch(`${baseUrl}/api/tasks/1/business-adoption`, { signal: AbortSignal.timeout(10_000), cache: "no-store" }),
  ]);
  if (unauthenticatedWalletReads.some((response) => response.status !== 401)) {
    throw new Error("DELIVERY_SMOKE_WALLET_WORKFLOW_AUTHENTICATION_NOT_ENFORCED");
  }
  const notificationResponse = await fetch(`${baseUrl}/api/notifications`, {
    headers: ownerHeaders, signal: AbortSignal.timeout(10_000), cache: "no-store",
  });
  if (!notificationResponse.ok || !notificationResponse.headers.get("cache-control")?.includes("no-store")) {
    throw new Error("DELIVERY_SMOKE_NOTIFICATION_RESPONSE_NOT_PRIVATE");
  }
  notificationsResponseSchema.parse(await notificationResponse.json());

  const dashboard = publicDashboardResponseSchema.parse(JSON.parse(bodies["/api/public/dashboard"]));
  if (dashboard.schemaVersion !== "2.6" || dashboard.mode !== "production"
    || dashboard.discovery?.a2aCompatible !== false
    || dashboard.discovery.manifest !== "/.well-known/agentgrid.json"
    || dashboard.discovery.openapi !== "/openapi.json"
    || !dashboard.trustBoundary?.redacted?.includes("hidden tests")
    || dashboard.actionContracts?.length !== 37
    || !dashboard.actionContracts.some((action) => action.id === "lease-job" && action.operationId === "leaseAgentJob"
      && action.phase === "AGENT_OPERATIONS" && action.method === "POST"
      && action.endpoint === "/api/agent/jobs/lease" && action.authentication && action.effect)
    || !dashboard.actionContracts.some((action) => action.operationId === "uploadHiddenTestCiphertext" && action.method === "PUT")
    || !dashboard.actionContracts.some((action) => action.operationId === "submitBusinessAdoption" && action.phase === "PUBLISHING")
    || !dashboard.actionContracts.some((action) => action.operationId === "listWalletNotifications" && action.phase === "WALLET_OPERATIONS")) {
    throw new Error("DELIVERY_SMOKE_AI_DASHBOARD_CONTRACT_INVALID");
  }

  const openapi = JSON.parse(bodies["/openapi.json"]) as {
    info?: { version?: string };
    paths?: Record<string, Record<string, {
      operationId?: string;
      parameters?: Array<{ in?: string; schema?: Record<string, unknown> }>;
      responses?: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string; additionalProperties?: boolean } } } }>;
    }>>;
    components?: {
      schemas?: Record<string, {
        type?: string; additionalProperties?: boolean; unevaluatedProperties?: boolean;
        properties?: Record<string, { enum?: string[] }>;
        "x-agentgrid-kind-payload"?: Record<string, string>;
        "x-agentgrid-kind-role"?: Record<string, string>;
        "x-agentgrid-kind-result"?: Record<string, string>;
        oneOf?: Array<{ type?: string; additionalProperties?: boolean }>;
      }>;
      securitySchemes?: Record<string, { "x-agentgrid-constraints"?: { minLength?: number; maxLength?: number; pattern?: string; duplicates?: string } }>;
    };
  };
  const requiredPaths = ["/api/public/dashboard", "/api/tasks", "/api/artifacts/uploads", "/api/hidden-tests/uploads", "/api/tasks/{taskId}/business-adoption", "/api/notifications", "/api/notifications/{notificationId}/read"];
  if (openapi.info?.version !== "0.8.16" || requiredPaths.some((route) => !openapi.paths?.[route])
    || !openapi.paths?.["/api/agents"]?.get || !openapi.paths?.["/api/agents"]?.post) {
    throw new Error("DELIVERY_SMOKE_OPENAPI_CONTRACT_INVALID");
  }
  const agentIdConstraints = openapi.components?.securitySchemes?.AgentId?.["x-agentgrid-constraints"];
  const agentKeyConstraints = openapi.components?.securitySchemes?.AgentKey?.["x-agentgrid-constraints"];
  if (agentIdConstraints?.minLength !== 3 || agentIdConstraints.maxLength !== 120
    || agentIdConstraints.pattern !== "^[A-Za-z0-9][A-Za-z0-9._:-]*$" || agentIdConstraints.duplicates !== "rejected"
    || agentKeyConstraints?.minLength !== 8 || agentKeyConstraints.maxLength !== 128
    || agentKeyConstraints.pattern !== "^amp_[A-Za-z0-9_-]+$" || agentKeyConstraints.duplicates !== "rejected") {
    throw new Error("DELIVERY_SMOKE_AGENT_AUTH_HEADER_CONTRACT_INVALID");
  }
  const agentJobContract = openapi.components?.schemas?.AgentJob;
  const agentJobCompletionContract = openapi.components?.schemas?.AgentJobCompletionResult;
  if (JSON.stringify(agentJobContract?.properties?.kind?.enum) !== JSON.stringify(agentJobKinds)
    || Object.keys(agentJobContract?.["x-agentgrid-kind-payload"] ?? {}).sort().join(",") !== [...agentJobKinds].sort().join(",")
    || Object.keys(agentJobContract?.["x-agentgrid-kind-role"] ?? {}).sort().join(",") !== [...agentJobKinds].sort().join(",")
    || Object.keys(agentJobCompletionContract?.["x-agentgrid-kind-result"] ?? {}).sort().join(",") !== [...agentJobKinds].sort().join(",")) {
    throw new Error("DELIVERY_SMOKE_AGENT_JOB_CONTRACT_INVALID");
  }
  const uuidPathSchema = { type: "string", format: "uuid" };
  const taskPathSchema = { type: "string", minLength: 1, maxLength: 78, pattern: "^[1-9][0-9]*$" };
  const agentPathSchema = { type: "string", minLength: 3, maxLength: 120, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" };
  const jobPathSchema = { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" };
  const pathContracts: Array<[string, string[], Record<string, unknown>]> = [
    ["/api/tasks/{taskId}", ["get"], taskPathSchema],
    ["/api/chain/task-commitments/{commitmentId}/transaction", ["post", "delete"], uuidPathSchema],
    ["/api/agents/{agentId}/credentials", ["post", "delete"], agentPathSchema],
    ["/api/agent/jobs/{jobId}/heartbeat", ["post"], jobPathSchema],
    ["/api/agent/jobs/{jobId}/complete", ["post"], jobPathSchema],
    ["/api/agent/evaluations/{taskId}", ["get", "post"], taskPathSchema],
    ["/api/artifacts/{artifactId}/finalize", ["post"], uuidPathSchema],
    ["/api/artifacts/tasks/{taskId}/download", ["post"], taskPathSchema],
    ["/api/artifacts/tasks/{taskId}/contributions", ["post"], taskPathSchema],
    ["/api/artifacts/tasks/{taskId}/release", ["post"], taskPathSchema],
    ["/api/hidden-tests/{manifestId}/content", ["put"], uuidPathSchema],
    ["/api/hidden-tests/{manifestId}/finalize", ["post"], uuidPathSchema],
    ["/api/notifications/{notificationId}/read", ["post"], uuidPathSchema],
    ["/api/tasks/{taskId}/business-adoption", ["get", "post"], taskPathSchema],
  ];
  let dynamicPathOperations = 0;
  for (const [route, methods, expectedSchema] of pathContracts) for (const method of methods) {
    dynamicPathOperations += 1;
    const operation = openapi.paths?.[route]?.[method];
    const parameters = operation?.parameters?.filter((parameter) => parameter.in === "path") ?? [];
    if (parameters.length !== 1 || JSON.stringify(parameters[0]?.schema) !== JSON.stringify(expectedSchema)
      || operation?.responses?.["400"]?.content?.["application/json"]?.schema?.$ref !== "#/components/schemas/ProtocolErrorResponse") {
      throw new Error(`DELIVERY_SMOKE_DYNAMIC_PATH_CONTRACT_INVALID_${method.toUpperCase()}_${route}`);
    }
  }
  if (dynamicPathOperations !== 18) throw new Error("DELIVERY_SMOKE_DYNAMIC_PATH_OPERATION_COUNT_INVALID");
  const hiddenContentResponses = openapi.paths?.["/api/hidden-tests/{manifestId}/content"]?.put?.responses;
  for (const status of ["400", "401", "403", "409", "413", "415", "500"]) {
    if (hiddenContentResponses?.[status]?.content?.["application/json"]?.schema?.$ref !== "#/components/schemas/ProtocolErrorResponse") {
      throw new Error(`DELIVERY_SMOKE_HIDDEN_CONTENT_ERROR_CONTRACT_INVALID_${status}`);
    }
  }
  let productionOperations = 0;
  let successfulResponseContracts = 0;
  let errorResponseContracts = 0;
  for (const [route, methods] of Object.entries(openapi.paths ?? {})) for (const [method, operation] of Object.entries(methods)) {
    if (!operation.operationId) continue;
    productionOperations += 1;
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      if (!/^2\d\d$/.test(status)) continue;
      successfulResponseContracts += 1;
      const schema = response.content?.["application/json"]?.schema;
      const reference = schema?.$ref;
      const component = reference ? openapi.components?.schemas?.[reference.replace("#/components/schemas/", "")] : schema;
      const objects = component?.oneOf?.filter((item) => item.type === "object") ?? (component ? [component] : []);
      if (!objects.length || objects.some((item) => item.additionalProperties !== false)) {
        throw new Error(`DELIVERY_SMOKE_OPENAPI_SUCCESS_RESPONSE_INVALID_${method.toUpperCase()}_${route}_${status}`);
      }
    }
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      if (!/^[45]\d\d$/.test(status)) continue;
      errorResponseContracts += 1;
      if (response.content?.["application/json"]?.schema?.$ref !== "#/components/schemas/ProtocolErrorResponse") {
        throw new Error(`DELIVERY_SMOKE_OPENAPI_ERROR_RESPONSE_INVALID_${method.toUpperCase()}_${route}_${status}`);
      }
    }
  }
  if (productionOperations !== 37 || successfulResponseContracts !== 38) throw new Error("DELIVERY_SMOKE_OPENAPI_SUCCESS_RESPONSE_COUNT_INVALID");
  if (errorResponseContracts !== 185) throw new Error("DELIVERY_SMOKE_OPENAPI_ERROR_RESPONSE_COUNT_INVALID");

  const discovery = discoveryResponseSchema.parse(JSON.parse(bodies["/.well-known/agentgrid.json"]));
  if (discovery.schemaVersion !== "1.1" || discovery.a2aCompatible !== false
    || discovery.publicAiDashboard !== "/api/public/dashboard" || discovery.openapi !== "/openapi.json"
    || discovery.businessAdoption !== "/api/tasks/{taskId}/business-adoption"
    || discovery.walletNotifications !== "/api/notifications"
    || discovery.walletNotificationRead !== "/api/notifications/{notificationId}/read"
    || discovery.publicTask !== "/api/tasks/{taskId}"
    || discovery.jobHeartbeat !== "/api/agent/jobs/{jobId}/heartbeat"
    || discovery.jobCompletion !== "/api/agent/jobs/{jobId}/complete"
    || discovery.typescriptSdkSource !== "https://raw.githubusercontent.com/murphumm-collab/agentgrid/main/src/sdk/client.ts"
    || !discovery.sdkNote?.includes("loopback-only Demo client")) {
    throw new Error("DELIVERY_SMOKE_MACHINE_DISCOVERY_INVALID");
  }

  const publicSurface = Object.values(bodies).join("\n");
  for (const [name, value] of Object.entries(secretValues)) {
    if (value && publicSurface.includes(value)) throw new Error(`DELIVERY_SMOKE_PUBLIC_SECRET_LEAK_${name}`);
  }
  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  const session = await sessionResponse.json() as { session?: unknown };
  const cacheControl = sessionResponse.headers.get("cache-control")?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  const vary = sessionResponse.headers.get("vary")?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  if (!sessionResponse.ok || session.session !== null
    || !cacheControl.includes("private") || !cacheControl.includes("no-store")
    || !vary.includes("cookie")) {
    throw new Error(`DELIVERY_SMOKE_LOGGED_OUT_SESSION_INSPECTION_INVALID_${JSON.stringify({
      status: sessionResponse.status,
      session: session.session,
      cacheControl: sessionResponse.headers.get("cache-control"),
      vary: sessionResponse.headers.get("vary"),
    })}`);
  }
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
  const payload = apiErrorResponseSchema.parse(await response.json());
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
    origin: baseUrl, cookie: `agentgrid-session=${session}`,
    "content-type": "application/octet-stream",
  };
  await expectBodyPolicyError(await fetch(`${baseUrl}/api/hidden-tests/${manifestId}/content`, {
    method: "PUT", headers, body: "", signal: AbortSignal.timeout(10_000),
  }), 400, "BINARY_BODY_REQUIRED");
  await expectBodyPolicyError(await fetch(`${baseUrl}/api/hidden-tests/${manifestId}/content`, {
    method: "PUT", headers, body: new Uint8Array(5), signal: AbortSignal.timeout(10_000),
  }), 409, "BINARY_CONTENT_LENGTH_MISMATCH");
  const oversizedStream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); controller.close(); },
  });
  const request = new Request(`${baseUrl}/api/hidden-tests/${manifestId}/content`, {
    method: "PUT", headers, body: oversizedStream, duplex: "half", signal: AbortSignal.timeout(10_000),
  } as RequestInit & { duplex: "half" });
  await expectBodyPolicyError(await fetch(request), 413, "REQUEST_BODY_TOO_LARGE");
}

async function publisherHeaders(baseUrl: string, authSecret: string) {
  return walletHeaders(baseUrl, authSecret, publisher);
}

async function walletHeaders(baseUrl: string, authSecret: string, address: string) {
  const session = await new SignJWT({ address, chainId: 97 })
    .setProtectedHeader({ alg: "HS256" }).setSubject(address.toLowerCase()).setIssuedAt().setExpirationTime("10m")
    .setIssuer("agentgrid").setAudience("agentgrid-web").sign(new TextEncoder().encode(authSecret));
  return { origin: baseUrl, cookie: `agentgrid-session=${session}`, "content-type": "application/json" };
}

async function main() {
  const { compileContracts } = await import("../contracts/scripts/compiler");
  const artifacts = compileContracts();
  const runtimeCodes: Record<string, string> = {
    [contractAddresses.token.toLowerCase()]: artifacts.TestToken.deployedBytecode,
    [contractAddresses.stakeManager.toLowerCase()]: artifacts.StakeCreditManager.deployedBytecode,
    [contractAddresses.agentRegistry.toLowerCase()]: artifacts.AgentRegistry.deployedBytecode,
    [contractAddresses.rewardVault.toLowerCase()]: artifacts.RewardVault.deployedBytecode,
    [contractAddresses.taskRegistry.toLowerCase()]: artifacts.TaskRegistry.deployedBytecode,
    [contractAddresses.disputeResolver.toLowerCase()]: artifacts.DisputeResolver.deployedBytecode,
    [contractAddresses.verificationPanel.toLowerCase()]: artifacts.VerificationPanel.deployedBytecode,
    [contractAddresses.verificationArbitrationCourt.toLowerCase()]: artifacts.VerificationArbitrationCourt.deployedBytecode,
    [contractAddresses.protocolEconomics.toLowerCase()]: artifacts.ProtocolEconomics.deployedBytecode,
    [contractAddresses.competitionSlotPassRegistry.toLowerCase()]: artifacts.CompetitionSlotPassRegistry.deployedBytecode,
  };
  const admin = new Pool({ connectionString: baseDatabaseUrl, max: 1 });
  const redis = createClient({ url: redisUrl });
  const rpc = await rpcServer(runtimeCodes);
  const specAi = await specAssistantAiServer();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const isolatedDatabaseUrl = new URL(baseDatabaseUrl);
  isolatedDatabaseUrl.username = databaseRole;
  isolatedDatabaseUrl.password = databasePassword;
  isolatedDatabaseUrl.searchParams.set("options", `-c search_path=${schema}`);
  const secretFolder = mkdtempSync(path.join(tmpdir(), "agentgrid-delivery-secrets-"));
  const runtimeFolder = mkdtempSync(path.join(tmpdir(), "agentgrid-delivery-web-"));
  const runtimeRoot = path.join(runtimeFolder, "standalone");
  cpSync(path.join(workspace, ".next", "standalone"), runtimeRoot, { recursive: true });
  mkdirSync(path.join(runtimeRoot, ".next"), { recursive: true });
  cpSync(path.join(workspace, ".next", "static"), path.join(runtimeRoot, ".next", "static"), { recursive: true });
  cpSync(path.join(workspace, "public"), path.join(runtimeRoot, "public"), { recursive: true });
  const secretValues: Record<string, string> = {
    DATABASE_URL: isolatedDatabaseUrl.toString(),
    AUTH_SECRET: `runtime-auth-${randomBytes(32).toString("hex")}`,
    S3_ACCESS_KEY: s3AccessKey,
    S3_SECRET_KEY: s3SecretKey,
    ARTIFACT_MASTER_KEY: artifactMasterKey,
    ADMIN_API_KEY: `runtime-admin-${randomBytes(32).toString("hex")}`,
    ALERT_WEBHOOK_SECRET: `runtime-alert-${randomBytes(32).toString("hex")}`,
    SPEC_ASSISTANT_AI_API_KEY: `runtime-ai-${randomBytes(32).toString("hex")}`,
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
    SPEC_ASSISTANT_AI_API_KEY_FILE: secretFiles.SPEC_ASSISTANT_AI_API_KEY,
    SPEC_ASSISTANT_AI_BASE_URL: specAi.url,
    SPEC_ASSISTANT_AI_ALLOWED_ORIGINS: new URL(specAi.url).origin,
    SPEC_ASSISTANT_AI_MODELS: "requirements-smoke,critic-smoke",
    S3_ENDPOINT: s3Endpoint,
    S3_REGION: "us-east-1",
    S3_BUCKET: "agentgrid-artifacts",
    S3_ACCESS_KEY_FILE: secretFiles.S3_ACCESS_KEY,
    S3_SECRET_KEY_FILE: secretFiles.S3_SECRET_KEY,
    BSC_TESTNET_RPC_URL: rpc.url,
    BSC_CHAIN_ID: "97",
    CHAIN_CONFIRMATIONS: "5",
    WALLETCONNECT_PROJECT_ID: "delivery-smoke-walletconnect-project",
    TOKEN_ADDRESS: contractAddresses.token,
    STAKE_MANAGER_ADDRESS: contractAddresses.stakeManager,
    AGENT_REGISTRY_ADDRESS: contractAddresses.agentRegistry,
    TASK_REGISTRY_ADDRESS: contractAddresses.taskRegistry,
    REWARD_VAULT_ADDRESS: contractAddresses.rewardVault,
    DISPUTE_RESOLVER_ADDRESS: contractAddresses.disputeResolver,
    VERIFICATION_PANEL_ADDRESS: contractAddresses.verificationPanel,
    VERIFICATION_ARBITRATION_COURT_ADDRESS: contractAddresses.verificationArbitrationCourt,
    PROTOCOL_ECONOMICS_ADDRESS: contractAddresses.protocolEconomics,
    COMPETITION_SLOT_PASS_REGISTRY_ADDRESS: contractAddresses.competitionSlotPassRegistry,
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
      cwd: runtimeRoot,
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
      database.agents.push({
        id: hiddenManagementAgentId, name: "Public identity, private management state",
        owner: "0x3333333333333333333333333333333333333333", role: "TESTER",
        capabilities: ["testing"], endpoint: hiddenManagementEndpoint, stake: 1_500,
        stakePositionId: "2", scopes: ["tests:submit"], revokedAt: hiddenManagementTimestamp,
        reputation: 75, completedTasks: 0, online: false,
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
    await verifyPackagedAiFrontend(baseUrl, secretValues);
    const readinessResponse = await fetch(`${baseUrl}/api/health/ready`, { signal: AbortSignal.timeout(10_000) });
    const readiness = await readinessResponse.json() as { checks?: Record<string, boolean> };
    if (!readinessResponse.ok || readiness.checks?.fileBackedSecrets !== true || readiness.checks?.taskDefinitionAi !== true
      || readiness.checks?.contractsDeployed !== true) throw new Error(`DELIVERY_SMOKE_FILE_SECRET_READINESS_FAILED_${readinessResponse.status}_${JSON.stringify(readiness.checks ?? {})}`);
    const tokenCodeKey = contractAddresses.token.toLowerCase();
    const originalTokenCode = runtimeCodes[tokenCodeKey];
    runtimeCodes[tokenCodeKey] = `0x${originalTokenCode[2] === "0" ? "1" : "0"}${originalTokenCode.slice(3)}`;
    const mismatchedReadinessResponse = await fetch(`${baseUrl}/api/health/ready`, { signal: AbortSignal.timeout(10_000) });
    const mismatchedReadiness = await mismatchedReadinessResponse.json() as { checks?: Record<string, boolean> };
    if (mismatchedReadinessResponse.status !== 503 || mismatchedReadiness.checks?.bscRpc !== true
      || mismatchedReadiness.checks?.contractsDeployed !== false) throw new Error("DELIVERY_SMOKE_WRONG_RUNTIME_BYTECODE_ACCEPTED");
    runtimeCodes[tokenCodeKey] = originalTokenCode;
    const restoredReadinessResponse = await fetch(`${baseUrl}/api/health/ready`, { signal: AbortSignal.timeout(10_000) });
    const restoredReadiness = await restoredReadinessResponse.json() as { checks?: Record<string, boolean> };
    if (!restoredReadinessResponse.ok || restoredReadiness.checks?.contractsDeployed !== true) throw new Error("DELIVERY_SMOKE_RUNTIME_BYTECODE_RECOVERY_FAILED");
    const authenticatedPublisherHeaders = await publisherHeaders(baseUrl, secretValues.AUTH_SECRET);
    const reviewedTitle = "Build a settlement monitoring service";
    const reviewedOutcome = "Alert settlement operations before a failed transfer breaches the committed service-level objective.";
    const reviewedCategory = "Automation";
    const reviewBody = {
      publisher, title: reviewedTitle, businessOutcome: reviewedOutcome, category: reviewedCategory,
      executionMode: "COLLABORATION", maxExecutors: 2,
      targetUsers: "Settlement operations owners who approve the monitored workflow",
      deliverables: ["Runnable monitored service archive", "Operator verification and rollback runbook"],
      constraints: ["No production credentials and no outbound network during independent verification"],
      outOfScope: ["Mainnet deployment and requirements introduced after publication"], assumptions: ["Input events follow the committed JSON schema"],
      criteria: [
        { description: "The service builds and all sealed tests pass", verificationMethod: "Run the fixed build and sealed test commands in the protocol sandbox", evidenceRequired: "Tester-signed exit codes, test manifest hash and artifact hash", passCondition: "Build exit code equals 0 and failed test count equals 0", verificationType: "AUTOMATED_TEST", required: true },
        { description: "Critical branch coverage meets the committed threshold", verificationMethod: "Run verifier-owned coverage collection against every delivered source module", evidenceRequired: "Tester-signed coverage metrics and artifact hash", passCondition: "Critical branch coverage is greater than or equal to 95%", verificationType: "AUTOMATED_TEST", required: true },
      ],
    };
    const unauthenticatedReview = await fetch(`${baseUrl}/api/task-spec-assistant`, {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000), body: JSON.stringify(reviewBody),
    });
    if (unauthenticatedReview.status !== 401) throw new Error("DELIVERY_SMOKE_TASK_DEFINITION_WALLET_SESSION_NOT_REQUIRED");
    const reviewResponse = await fetch(`${baseUrl}/api/task-spec-assistant`, {
      method: "POST", headers: authenticatedPublisherHeaders, signal: AbortSignal.timeout(10_000), body: JSON.stringify(reviewBody),
    });
    const reviewed = await reviewResponse.json() as {
      error?: string; assessment?: { ready?: boolean }; reviews?: Array<{ provider?: string }>;
      definitionReview?: { id?: string; expiresAt?: string } | null;
      recommendation?: { acceptanceCriteria?: Array<{ description: string }> } & Record<string, unknown>;
    };
    if (!reviewResponse.ok || reviewed.assessment?.ready !== true || !reviewed.definitionReview?.id || !reviewed.recommendation
      || reviewed.reviews?.filter((item) => item.provider === new URL(specAi.url).origin).length !== 2) {
      throw new Error(`DELIVERY_SMOKE_TASK_DEFINITION_REVIEW_FAILED_${reviewed.error ?? "INVALID_RESPONSE"}`);
    }
    const reviewedHiddenTestId = randomUUID();
    const reviewedHiddenTestHash = randomBytes(32).toString("hex");
    await store.createHiddenTestManifest({
      id: reviewedHiddenTestId, publisher, objectKey: `hidden-tests/${publisher.toLowerCase()}/${reviewedHiddenTestId}`,
      sha256: randomBytes(32).toString("hex"), plaintextSha256: reviewedHiddenTestHash, sizeBytes: 8, contentType: "application/gzip",
      encryptionAlgorithm: "AES-256-GCM", contentIv: randomBytes(12).toString("base64"), sealedKey: randomBytes(32).toString("base64"),
      sealIv: randomBytes(12).toString("base64"), sealTag: randomBytes(16).toString("base64"),
    });
    await store.finalizeHiddenTestManifest(reviewedHiddenTestId, publisher);
    const reviewedCommitmentBody = {
      publisher, definitionReviewId: reviewed.definitionReview.id, stakePositionId: 9, title: reviewedTitle, description: reviewedOutcome,
      category: reviewedCategory, executionMode: "COLLABORATION", maxExecutors: 2, declaredDurationHours: 48,
      criteria: reviewed.recommendation.acceptanceCriteria!.map((criterion) => criterion.description), completionDefinition: reviewed.recommendation,
      requestedReward: 2500, hiddenTestManifestId: reviewedHiddenTestId, hiddenTestPlaintextSha256: reviewedHiddenTestHash,
    };
    const commitmentResponse = await fetch(`${baseUrl}/api/chain/task-commitments`, {
      method: "POST", headers: authenticatedPublisherHeaders, signal: AbortSignal.timeout(10_000), body: JSON.stringify(reviewedCommitmentBody),
    });
    const committed = await commitmentResponse.json() as { error?: string; id?: string };
    if (!commitmentResponse.ok || !committed.id) throw new Error(`DELIVERY_SMOKE_REVIEWED_COMMITMENT_FAILED_${committed.error ?? "INVALID_RESPONSE"}`);
    const recoveredBeforeBroadcastResponse = await fetch(`${baseUrl}/api/chain/task-commitments`, {
      headers: authenticatedPublisherHeaders, signal: AbortSignal.timeout(10_000), cache: "no-store",
    });
    const recoveredBeforeBroadcast = await recoveredBeforeBroadcastResponse.json() as { error?: string; pending?: { commitmentId?: string; specHash?: string; transactionHash?: string; broadcastReady?: boolean } };
    if (!recoveredBeforeBroadcastResponse.ok || recoveredBeforeBroadcast.pending?.commitmentId !== committed.id
      || recoveredBeforeBroadcast.pending.transactionHash || recoveredBeforeBroadcast.pending.broadcastReady !== false) {
      throw new Error(`DELIVERY_SMOKE_COMMITMENT_RECOVERY_FAILED_${recoveredBeforeBroadcast.error ?? "INVALID_RESPONSE"}`);
    }
    const revertedEvaluationTransaction = `0x${"de".repeat(32)}`;
    const bindResponse = await fetch(`${baseUrl}/api/chain/task-commitments/${encodeURIComponent(committed.id)}/transaction`, {
      method: "POST", headers: authenticatedPublisherHeaders, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ publisher, transactionHash: revertedEvaluationTransaction }),
    });
    const bound = await bindResponse.json() as { error?: string; transactionHash?: string };
    if (!bindResponse.ok || bound.transactionHash !== revertedEvaluationTransaction) throw new Error(`DELIVERY_SMOKE_TRANSACTION_BIND_FAILED_${bound.error ?? "INVALID_RESPONSE"}`);
    const recoveredAfterBroadcastResponse = await fetch(`${baseUrl}/api/chain/task-commitments`, {
      headers: authenticatedPublisherHeaders, signal: AbortSignal.timeout(10_000), cache: "no-store",
    });
    const recoveredAfterBroadcast = await recoveredAfterBroadcastResponse.json() as { pending?: { transactionHash?: string } };
    if (!recoveredAfterBroadcastResponse.ok || recoveredAfterBroadcast.pending?.transactionHash !== revertedEvaluationTransaction) throw new Error("DELIVERY_SMOKE_BOUND_TRANSACTION_NOT_RECOVERED");
    const clearResponse = await fetch(`${baseUrl}/api/chain/task-commitments/${encodeURIComponent(committed.id)}/transaction`, {
      method: "DELETE", headers: authenticatedPublisherHeaders, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ publisher, transactionHash: revertedEvaluationTransaction }),
    });
    const cleared = await clearResponse.json() as { error?: string; cleared?: boolean };
    if (!clearResponse.ok || cleared.cleared !== true) throw new Error(`DELIVERY_SMOKE_REVERTED_TRANSACTION_CLEAR_FAILED_${cleared.error ?? "INVALID_RESPONSE"}`);
    const reviewReplayResponse = await fetch(`${baseUrl}/api/chain/task-commitments`, {
      method: "POST", headers: authenticatedPublisherHeaders, signal: AbortSignal.timeout(10_000), body: JSON.stringify(reviewedCommitmentBody),
    });
    const reviewReplay = await reviewReplayResponse.json() as { error?: string };
    if (reviewReplayResponse.status !== 409 || reviewReplay.error !== "TASK_DEFINITION_REVIEW_REQUIRED") throw new Error("DELIVERY_SMOKE_DEFINITION_REVIEW_REPLAY_ACCEPTED");
    const chainConfigResponse = await fetch(`${baseUrl}/api/chain/config`, { signal: AbortSignal.timeout(10_000) });
    const chainConfig = chainConfigResponseSchema.parse(await chainConfigResponse.json());
    if (
      !chainConfigResponse.ok || chainConfig.chainId !== 97 || chainConfig.confirmations !== 5 ||
      chainConfig.walletConnectProjectId !== "delivery-smoke-walletconnect-project" ||
      Object.values(chainConfig.contracts ?? {}).length !== 10 ||
      Object.entries({
        token: contractAddresses.token,
        stakeManager: contractAddresses.stakeManager,
        agentRegistry: contractAddresses.agentRegistry,
        taskRegistry: contractAddresses.taskRegistry,
        rewardVault: contractAddresses.rewardVault,
        disputeResolver: contractAddresses.disputeResolver,
        verificationPanel: contractAddresses.verificationPanel,
        verificationArbitrationCourt: contractAddresses.verificationArbitrationCourt,
        protocolEconomics: contractAddresses.protocolEconomics,
        competitionSlotPassRegistry: contractAddresses.competitionSlotPassRegistry,
      }).some(([key, address]) => chainConfig.contracts?.[key]?.toLowerCase() !== address.toLowerCase())
    ) throw new Error("DELIVERY_SMOKE_RUNTIME_BROWSER_CHAIN_CONFIG_FAILED");
    await verifyJsonBodyPolicy(baseUrl);
    await verifyBinaryBodyPolicy(baseUrl, binaryLimitManifestId, secretValues.AUTH_SECRET);
    const firstLease = leaseJobResponseSchema.parse(await postJson(baseUrl, "/api/agent/jobs/lease", { agentId, role: "EXECUTOR" }));
    if (!firstLease?.job?.id) throw new Error("DELIVERY_SMOKE_FIRST_LEASE_MISSING");
    const jobId = firstLease.job.id;
    await stopWeb(web);
    web = undefined;

    web = await startWeb();
    await sleep((firstLease.leaseSeconds + 1) * 1_000);
    const recovered = leaseJobResponseSchema.parse(await postJson(baseUrl, "/api/agent/jobs/lease", { agentId, role: "EXECUTOR" }));
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
    const uploadBody = {
      taskId, agentId, sha256, sizeBytes: ciphertext.length, contentType: "application/gzip",
      plaintextSha256, encryptionAlgorithm: "AES-256-GCM", contentIv: contentIv.toString("base64"),
      encryptionKey: encryptionKey.toString("base64"),
    } as const;
    const malformedArtifactUpload = await fetch(`${baseUrl}/api/artifacts/uploads`, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-key": apiKey },
      body: JSON.stringify({ ...uploadBody, unexpected: true }), signal: AbortSignal.timeout(10_000),
    });
    if (malformedArtifactUpload.status !== 400) {
      throw new Error(`DELIVERY_SMOKE_ARTIFACT_UPLOAD_SCHEMA_NOT_ENFORCED_${malformedArtifactUpload.status}`);
    }
    const upload = await postJson<{ id: string; objectKey: string; uploadUrl: string; headers: Record<string, string> }>(baseUrl, "/api/artifacts/uploads", uploadBody);
    createdObjectKeys.push(upload.objectKey);

    await stopWeb(web);
    web = undefined;
    const uploadResponse = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: ciphertext, signal: AbortSignal.timeout(10_000) });
    if (!uploadResponse.ok) throw new Error(`DELIVERY_SMOKE_ARTIFACT_UPLOAD_FAILED_${uploadResponse.status}`);
    web = await startWeb();
    await postJson(baseUrl, `/api/agent/jobs/${encodeURIComponent(jobId)}/heartbeat`, { agentId });
    const malformedFinalize = await fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(upload.id)}/finalize`, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-key": apiKey },
      body: JSON.stringify({ agentId, unexpected: true }), signal: AbortSignal.timeout(10_000),
    });
    if (malformedFinalize.status !== 400) {
      throw new Error(`DELIVERY_SMOKE_AGENT_ID_SCHEMA_NOT_ENFORCED_${malformedFinalize.status}`);
    }
    const finalized = await postJson<{ artifactHash: string; artifactUrl: string }>(baseUrl, `/api/artifacts/${encodeURIComponent(upload.id)}/finalize`, { agentId });
    if (finalized.artifactHash !== `sha256:${plaintextSha256}` || !finalized.artifactUrl.startsWith("s3://")) throw new Error("DELIVERY_SMOKE_FINALIZED_ARTIFACT_INVALID");
    createdObjectKeys.push(finalized.artifactUrl.split("/").slice(3).join("/"));
    const invalidCompletion = await fetch(`${baseUrl}/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-key": apiKey },
      body: JSON.stringify({ agentId, result: { artifactHash: finalized.artifactHash } }), signal: AbortSignal.timeout(10_000),
    });
    if (invalidCompletion.status !== 400) throw new Error(`DELIVERY_SMOKE_INVALID_COMPLETION_NOT_REJECTED_${invalidCompletion.status}`);
    await postJson(baseUrl, `/api/agent/jobs/${encodeURIComponent(jobId)}/heartbeat`, { agentId });
    const completionResult = { artifactHash: finalized.artifactHash, transactionHash: `0x${"a".repeat(64)}` };
    await postJson(baseUrl, `/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, { agentId, result: completionResult });
    await postJson(baseUrl, `/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, { agentId, result: completionResult });

    const completedAgain = await fetch(`${baseUrl}/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-key": apiKey },
      body: JSON.stringify({ agentId, result: { duplicate: true } }), signal: AbortSignal.timeout(10_000),
    });
    if (completedAgain.ok) throw new Error("DELIVERY_SMOKE_DUPLICATE_COMPLETION_ACCEPTED");
    const manifest = await store.artifactManifest(upload.id, agentId);
    if (manifest.status !== "READY") throw new Error("DELIVERY_SMOKE_ARTIFACT_NOT_DURABLE");
    const credentialHeaders = await walletHeaders(baseUrl, secretValues.AUTH_SECRET, owner);
    const rotateCredentialResponse = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/credentials`, {
      method: "POST", headers: credentialHeaders, signal: AbortSignal.timeout(10_000),
    });
    const rotatedCredential = await rotateCredentialResponse.json() as { apiKey?: string; error?: string };
    if (!rotateCredentialResponse.ok || !rotatedCredential.apiKey) throw new Error(`DELIVERY_SMOKE_CREDENTIAL_ROTATION_FAILED_${rotatedCredential.error ?? "INVALID_RESPONSE"}`);
    const oldCredentialResponse = await fetch(`${baseUrl}/api/agent/jobs/lease`, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-key": apiKey },
      body: JSON.stringify({ agentId, role: "EXECUTOR" }), signal: AbortSignal.timeout(10_000),
    });
    if (oldCredentialResponse.status !== 401) throw new Error("DELIVERY_SMOKE_OLD_CREDENTIAL_ACCEPTED");
    mockAgentActive = false;
    const revokeCredentialResponse = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/credentials`, {
      method: "DELETE", headers: credentialHeaders, signal: AbortSignal.timeout(10_000),
    });
    if (!revokeCredentialResponse.ok) throw new Error("DELIVERY_SMOKE_CREDENTIAL_REVOCATION_FAILED");
    const revokedCredentialResponse = await fetch(`${baseUrl}/api/agent/jobs/lease`, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-key": rotatedCredential.apiKey },
      body: JSON.stringify({ agentId, role: "EXECUTOR" }), signal: AbortSignal.timeout(10_000),
    });
    if (revokedCredentialResponse.status !== 401) throw new Error("DELIVERY_SMOKE_REVOKED_CREDENTIAL_ACCEPTED");
    mockAgentActive = true;
    const recoverCredentialResponse = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(agentId)}/credentials`, {
      method: "POST", headers: credentialHeaders, signal: AbortSignal.timeout(10_000),
    });
    const recoveredCredential = await recoverCredentialResponse.json() as { apiKey?: string; error?: string };
    if (!recoverCredentialResponse.ok || !recoveredCredential.apiKey || recoveredCredential.apiKey === rotatedCredential.apiKey) {
      throw new Error(`DELIVERY_SMOKE_CREDENTIAL_RECOVERY_FAILED_${recoveredCredential.error ?? "INVALID_RESPONSE"}`);
    }
    const registrationRetryBody = {
      owner, name: "Delivery integration executor", role: "EXECUTOR",
      capabilities: ["typescript", "testing"], endpoint: baseUrl, stake: 0,
      stakePositionId: positionId, scopes: ["tasks:claim", "tasks:submit", "heartbeat:write"],
    };
    const malformedRegistration = await fetch(`${baseUrl}/api/agents`, {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000), body: JSON.stringify({ ...registrationRetryBody, unexpected: true }),
    });
    if (malformedRegistration.status !== 400) {
      throw new Error(`DELIVERY_SMOKE_REGISTRATION_SCHEMA_NOT_ENFORCED_${malformedRegistration.status}`);
    }
    const unauthenticatedRegistration = await fetch(`${baseUrl}/api/agents`, {
      method: "POST", headers: { origin: baseUrl, "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000), body: JSON.stringify(registrationRetryBody),
    });
    if (unauthenticatedRegistration.status !== 401) throw new Error("DELIVERY_SMOKE_REGISTRATION_WALLET_SESSION_NOT_REQUIRED");
    const retryRegistrationResponse = await fetch(`${baseUrl}/api/agents`, {
      method: "POST", headers: credentialHeaders, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify(registrationRetryBody),
    });
    const retriedRegistration = await retryRegistrationResponse.json() as {
      agent?: { id?: string }; apiKey?: string; recovered?: boolean; error?: string;
    };
    if (retryRegistrationResponse.status !== 200 || !retriedRegistration.recovered
      || retriedRegistration.agent?.id !== agentId || !retriedRegistration.apiKey
      || retriedRegistration.apiKey === recoveredCredential.apiKey) {
      throw new Error(`DELIVERY_SMOKE_REGISTRATION_RECOVERY_FAILED_${retriedRegistration.error ?? "INVALID_RESPONSE"}`);
    }
    const supersededRecoveryKey = await fetch(`${baseUrl}/api/agent/jobs/lease`, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-key": recoveredCredential.apiKey },
      body: JSON.stringify({ agentId, role: "EXECUTOR" }), signal: AbortSignal.timeout(10_000),
    });
    if (supersededRecoveryKey.status !== 401) throw new Error("DELIVERY_SMOKE_REGISTRATION_RECOVERY_OLD_KEY_ACCEPTED");
    const recoveredRegistrationKey = await fetch(`${baseUrl}/api/agent/jobs/lease`, {
      method: "POST", headers: { "content-type": "application/json", "x-agent-key": retriedRegistration.apiKey },
      body: JSON.stringify({ agentId, role: "EXECUTOR" }), signal: AbortSignal.timeout(10_000),
    });
    if (!recoveredRegistrationKey.ok) throw new Error("DELIVERY_SMOKE_REGISTRATION_RECOVERY_NEW_KEY_REJECTED");
    const invalidVerificationBody = JSON.stringify({
      address: owner,
      nonce: "00".repeat(16),
      message: "invalid one-time wallet challenge",
      signature: `0x${"00".repeat(65)}`,
    });
    const malformedVerification = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ ...JSON.parse(invalidVerificationBody), unexpected: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (malformedVerification.status !== 400) {
      throw new Error(`DELIVERY_SMOKE_WALLET_VERIFY_SCHEMA_NOT_ENFORCED_${malformedVerification.status}`);
    }
    const malformedVerificationError = apiErrorResponseSchema.parse(await malformedVerification.json());
    if (malformedVerificationError.error !== "VALIDATION_ERROR" || !malformedVerificationError.issues?.length) {
      throw new Error("DELIVERY_SMOKE_VALIDATION_ERROR_CONTRACT_INVALID");
    }
    for (let attempt = 2; attempt <= 21; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/auth/verify`, {
        method: "POST",
        headers: { origin: baseUrl, "content-type": "application/json" },
        body: invalidVerificationBody,
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json() as { error?: string };
      if (attempt <= 20 && (response.status !== 401 || body.error !== "AUTH_CHALLENGE_INVALID_OR_EXPIRED")) {
        throw new Error(`DELIVERY_SMOKE_WALLET_VERIFY_AUTH_STATUS_INVALID_${response.status}_${body.error ?? "UNKNOWN"}`);
      }
      if (attempt === 21 && (response.status !== 429 || body.error !== "RATE_LIMIT_EXCEEDED")) {
        throw new Error(`DELIVERY_SMOKE_WALLET_VERIFY_LIMIT_MISSING_${response.status}_${body.error ?? "UNKNOWN"}`);
      }
    }
    console.log(JSON.stringify({
      isolatedSchema: true,
      packagedFrontendRuntime: true,
      aiDashboardRuntime: true,
      machineDiscoveryRuntime: true,
      sdkResponseContractsRuntime: true,
      publicAgentDirectoryRuntime: true,
      publicSecretsRedacted: true,
      webProcessCrashRecovered: true,
      sameJobRecovered: recovered.job.id === jobId,
      strictAgentJobContractRuntime: true,
      strictAgentJobCompletionContractRuntime: true,
      artifactManifestSurvivedRestart: true,
      encryptedArtifactVerifiedAndSealed: true,
      closedArtifactRequestSchemas: true,
      duplicateCompletionRejected: true,
      onchainCredentialStatusSynchronized: true,
      registrationResponseRecovery: true,
      registrationWalletSessionRequired: true,
      registrationSchemaEnforced: true,
      agentManagementOwnerBound: true,
      fileBackedReadiness: true,
      exactRuntimeBytecodeReadiness: true,
      wrongRuntimeBytecodeRejected: true,
      disputeResolverRuntimeVerified: true,
      externalAiDefinitionReview: true,
      taskDefinitionReviewWalletSessionRequired: true,
      loggedOutSessionInspectable: true,
      walletAuthSchemaEnforced: true,
      walletVerificationRateLimited: true,
      definitionReviewBoundAndConsumed: true,
      definitionReviewReplayRejected: true,
      serverCommitmentCrashRecovery: true,
      evaluationTransactionHashRecovered: true,
      revertedTransactionServerVerified: true,
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
    const s3 = new S3Client({ endpoint: s3Endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey } });
    for (const key of createdObjectKeys.filter(Boolean)) await s3.send(new DeleteObjectCommand({ Bucket: "agentgrid-artifacts", Key: key })).catch(() => undefined);
    if (minioUserCreated) await minioAdmin('IFS= read -r root_access; IFS= read -r root_secret; IFS= read -r access; mc alias set agentgrid-smoke http://127.0.0.1:9000 "$root_access" "$root_secret" >/dev/null; mc admin user remove agentgrid-smoke "$access"; mc alias rm agentgrid-smoke >/dev/null', `${localMinioRootAccess}\n${localMinioRootSecret}\n${s3AccessKey}\n`).catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${databaseRole}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    await closeServer(rpc.server).catch(() => undefined);
    await closeServer(specAi.server).catch(() => undefined);
    rmSync(secretFolder, { recursive: true, force: true });
    rmSync(runtimeFolder, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
