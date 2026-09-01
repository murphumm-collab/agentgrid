import type { z } from "zod";
import { apiErrorResponseSchema, type ApiErrorResponse } from "../lib/api-error-schema";
import type { AgentJobCompletionResult } from "../lib/agent-job-schema";
import {
  artifactFinalizeResponseSchema,
  artifactUploadResponseSchema,
  assignedEvaluationResponseSchema,
  chainConfigResponseSchema,
  completeJobResponseSchema,
  completedTasksResponseSchema,
  discoveryResponseSchema,
  heartbeatJobResponseSchema,
  leaseJobResponseSchema,
  publicAgentsResponseSchema,
  publicDashboardResponseSchema,
  publicStatisticsResponseSchema,
  publicTaskResponseSchema,
  publicTasksResponseSchema,
  submittedEvaluationResponseSchema,
  submittedEvidenceResponseSchema,
  teamContributionsResponseSchema,
  testerArtifactAccessResponseSchema,
} from "./response-schemas";

export interface AgentClientOptions {
  baseUrl: string;
  agentId?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class AgentProtocolError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null = null,
    public readonly issues?: ApiErrorResponse["issues"],
  ) {
    super(code);
    this.name = "AgentProtocolError";
  }
}

const maximumJsonResponseBytes = 1024 * 1024;

function normalizedEndpoint(value: string, label: "BASE_URL" | "UPLOAD_URL") {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new AgentProtocolError(`${label}_INVALID`); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(["http:", "https:"].includes(url.protocol)) || (url.protocol !== "https:" && !loopback)) {
    throw new AgentProtocolError(`${label}_HTTPS_REQUIRED`);
  }
  if (url.username || url.password || url.search || url.hash) throw new AgentProtocolError(`${label}_INVALID`);
  return url;
}

export class AgentProtocolClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: AgentClientOptions) {
    const endpoint = normalizedEndpoint(options.baseUrl, "BASE_URL");
    this.baseUrl = endpoint.toString().replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 300_000) {
      throw new AgentProtocolError("REQUEST_TIMEOUT_INVALID");
    }
  }

  private async boundedJson(response: Response) {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maximumJsonResponseBytes) {
      throw new AgentProtocolError("PROTOCOL_RESPONSE_TOO_LARGE", response.status);
    }
    if (!response.body) throw new AgentProtocolError("PROTOCOL_RESPONSE_JSON_REQUIRED", response.status);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumJsonResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AgentProtocolError("PROTOCOL_RESPONSE_TOO_LARGE", response.status);
      }
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown; }
    catch { throw new AgentProtocolError("PROTOCOL_RESPONSE_JSON_INVALID", response.status); }
  }

  protected async request<T>(path: string, init?: RequestInit, authenticated = true, responseSchema?: z.ZodType<T>): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (authenticated && this.options.agentId && this.options.apiKey) {
      headers.set("x-agent-id", this.options.agentId);
      headers.set("x-agent-key", this.options.apiKey);
    }
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    init?.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init, headers, redirect: "error", signal: controller.signal,
      });
      const body = await this.boundedJson(response);
      if (!response.ok) {
        const parsed = apiErrorResponseSchema.safeParse(body);
        if (!parsed.success) throw new AgentProtocolError("PROTOCOL_ERROR_RESPONSE_SCHEMA_INVALID", response.status);
        throw new AgentProtocolError(parsed.data.error, response.status, parsed.data.issues);
      }
      if (!responseSchema) return body as T;
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) throw new AgentProtocolError("PROTOCOL_RESPONSE_SCHEMA_INVALID", response.status);
      return parsed.data;
    } catch (error) {
      if (error instanceof AgentProtocolError) throw error;
      if (timedOut) throw new AgentProtocolError("PROTOCOL_REQUEST_TIMEOUT");
      if (init?.signal?.aborted) throw new AgentProtocolError("PROTOCOL_REQUEST_ABORTED");
      throw new AgentProtocolError("PROTOCOL_NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
      init?.signal?.removeEventListener("abort", abort);
    }
  }

  private publicRequest<T>(path: string, responseSchema: z.ZodType<T>) {
    return this.request(path, undefined, false, responseSchema);
  }

  discovery() {
    return this.publicRequest("/.well-known/agentgrid.json", discoveryResponseSchema);
  }

  publicStatistics() {
    return this.publicRequest("/api/public/stats", publicStatisticsResponseSchema);
  }

  publicDashboard() {
    return this.publicRequest("/api/public/dashboard", publicDashboardResponseSchema);
  }

  chainConfig() {
    return this.publicRequest("/api/chain/config", chainConfigResponseSchema);
  }

  completedTasks(input: { limit?: number; cursor?: string; category?: string; executionMode?: "COLLABORATION" | "COMPETITION" } = {}) {
    const query = new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.publicRequest(`/api/public/tasks/completed${query.size ? `?${query}` : ""}`, completedTasksResponseSchema);
  }

  listTasks() {
    return this.publicRequest("/api/tasks", publicTasksResponseSchema);
  }

  listAgents() {
    return this.publicRequest("/api/agents", publicAgentsResponseSchema);
  }

  getTask(taskId: string) {
    return this.publicRequest(`/api/tasks/${encodeURIComponent(taskId)}`, publicTaskResponseSchema);
  }

  protected requireAgentId() {
    if (!this.options.agentId || !this.options.apiKey) throw new Error("AGENT_CREDENTIALS_REQUIRED");
    return this.options.agentId;
  }

  leaseJob(role: "EXECUTOR" | "TESTER" | "EVALUATOR") {
    return this.request("/api/agent/jobs/lease", {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId(), role }),
    }, true, leaseJobResponseSchema);
  }

  heartbeatJob(jobId: string) {
    return this.request(`/api/agent/jobs/${encodeURIComponent(jobId)}/heartbeat`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId() }),
    }, true, heartbeatJobResponseSchema);
  }

  completeJob(jobId: string, result: AgentJobCompletionResult) {
    return this.request(`/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId(), result }),
    }, true, completeJobResponseSchema);
  }

  async uploadArtifact(taskId: string, gzipArchive: Uint8Array) {
    const bytes = gzipArchive;
    if (bytes.byteLength < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("ARTIFACT_GZIP_ARCHIVE_REQUIRED");
    const contentType = "application/gzip" as const;
    const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("");
    const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
    const plaintextSha256 = hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const contentIv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: contentIv }, key, bytes as BufferSource));
    const sha256 = hex(await crypto.subtle.digest("SHA-256", ciphertext));
    const upload = await this.request("/api/artifacts/uploads", {
      method: "POST",
      body: JSON.stringify({ taskId, agentId: this.requireAgentId(), sha256, sizeBytes: ciphertext.byteLength, contentType, plaintextSha256, encryptionAlgorithm: "AES-256-GCM", contentIv: base64(contentIv), encryptionKey: base64(rawKey) }),
    }, true, artifactUploadResponseSchema);
    const uploadEndpoint = normalizedEndpoint(upload.uploadUrl, "UPLOAD_URL");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(uploadEndpoint, {
        method: "PUT", headers: upload.headers, body: ciphertext as BodyInit, redirect: "error", signal: controller.signal,
      });
    } catch {
      throw new AgentProtocolError(controller.signal.aborted ? "ARTIFACT_UPLOAD_TIMEOUT" : "ARTIFACT_UPLOAD_NETWORK_ERROR");
    } finally { clearTimeout(timer); }
    if (!response.ok) throw new AgentProtocolError(`ARTIFACT_UPLOAD_HTTP_${response.status}`, response.status);
    return this.request(`/api/artifacts/${upload.id}/finalize`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId() }),
    }, true, artifactFinalizeResponseSchema);
  }

  getArtifactForTesting(taskId: string) {
    return this.request(`/api/artifacts/tasks/${encodeURIComponent(taskId)}/download`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId() }),
    }, true, testerArtifactAccessResponseSchema);
  }

  getTeamContributions(taskId: string) {
    return this.request(`/api/artifacts/tasks/${encodeURIComponent(taskId)}/contributions`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId() }),
    }, true, teamContributionsResponseSchema);
  }

  getTaskEvaluation(taskId: string) {
    return this.request(`/api/agent/evaluations/${encodeURIComponent(taskId)}`, undefined, true, assignedEvaluationResponseSchema);
  }

  submitSignedTaskEvaluation(taskId: string, input: { chainId: 97; taskRegistry: string; report: Record<string, unknown>; signature: string }) {
    return this.request(`/api/agent/evaluations/${encodeURIComponent(taskId)}`, {
      method: "POST", body: JSON.stringify(input),
    }, true, submittedEvaluationResponseSchema);
  }

  submitSignedEvidence(input: { chainId: 97; taskRegistry: string; taskId: string; workRound: number; verificationShard: number; executionMode: "COLLABORATION" | "COMPETITION"; executorOrder: string[]; artifactHash: string; report: Record<string, unknown>; signature: string }) {
    return this.request("/api/evidence", {
      method: "POST", body: JSON.stringify({ ...input, testerAgentId: this.requireAgentId() }),
    }, true, submittedEvidenceResponseSchema);
  }
}
