export interface AgentClientOptions {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

export class AgentProtocolClient {
  constructor(private readonly options: AgentClientOptions) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-agent-id": this.options.agentId,
        "x-agent-key": this.options.apiKey,
        ...init?.headers,
      },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `Protocol request failed: ${response.status}`);
    return body as T;
  }

  listTasks() {
    return this.request<{ tasks: unknown[] }>("/api/tasks");
  }

  getTask(taskId: string) {
    return this.request<{ task: unknown; reward: unknown }>(`/api/tasks/${encodeURIComponent(taskId)}`);
  }

  claimTask(taskId: string) {
    return this.request(`/api/tasks/${taskId}/claim`, {
      method: "POST",
      body: JSON.stringify({ agentId: this.options.agentId }),
    });
  }

  submitWork(taskId: string, input: { artifactUrl: string; artifactHash: string; summary: string }) {
    return this.request(`/api/tasks/${taskId}/submit`, {
      method: "POST",
      body: JSON.stringify({ agentId: this.options.agentId, ...input }),
    });
  }

  submitTest(taskId: string, evidence: Record<string, unknown>, selectionProof: string) {
    return this.request(`/api/tasks/${taskId}/test`, {
      method: "POST",
      body: JSON.stringify({ testerId: this.options.agentId, evidence, selectionProof }),
    });
  }

  leaseJob(role: "EXECUTOR" | "TESTER" | "EVALUATOR") {
    return this.request<{ job: { id: string; kind: string; payload: Record<string, unknown> }; leaseSeconds: number } | null>("/api/agent/jobs/lease", {
      method: "POST", body: JSON.stringify({ agentId: this.options.agentId, role }),
    });
  }

  heartbeatJob(jobId: string) {
    return this.request<{ leaseSeconds: number }>(`/api/agent/jobs/${encodeURIComponent(jobId)}/heartbeat`, {
      method: "POST", body: JSON.stringify({ agentId: this.options.agentId }),
    });
  }

  completeJob(jobId: string, result?: unknown) {
    return this.request<{ completed: true }>(`/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST", body: JSON.stringify({ agentId: this.options.agentId, result }),
    });
  }

  async uploadArtifact(taskId: string, bytes: Uint8Array, contentType = "application/octet-stream") {
    const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("");
    const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
    const plaintextSha256 = hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const contentIv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: contentIv }, key, bytes as BufferSource));
    const sha256 = hex(await crypto.subtle.digest("SHA-256", ciphertext));
    const upload = await this.request<{ id: string; uploadUrl: string; headers: Record<string, string> }>("/api/artifacts/uploads", {
      method: "POST",
      body: JSON.stringify({ taskId, agentId: this.options.agentId, sha256, sizeBytes: ciphertext.byteLength, contentType, plaintextSha256, encryptionAlgorithm: "AES-256-GCM", contentIv: base64(contentIv), encryptionKey: base64(rawKey) }),
    });
    const response = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: ciphertext as BodyInit });
    if (!response.ok) throw new Error(`Artifact upload failed: ${response.status}`);
    return this.request<{ artifactUrl: string; artifactHash: string; sizeBytes: number; contentType: string }>(`/api/artifacts/${upload.id}/finalize`, {
      method: "POST", body: JSON.stringify({ agentId: this.options.agentId }),
    });
  }

  getArtifactForTesting(taskId: string) {
    return this.request<{ artifactHash: string; ciphertextHash: string; downloadUrl: string; decryptionKey: string; contentIv: string; encryptionAlgorithm: "AES-256-GCM"; sizeBytes: number; contentType: string; hiddenTest: { artifactHash: string; ciphertextHash: string; downloadUrl: string; decryptionKey: string; contentIv: string; encryptionAlgorithm: "AES-256-GCM"; sizeBytes: number; contentType: string } }>(`/api/artifacts/tasks/${encodeURIComponent(taskId)}/download`, {
      method: "POST", body: JSON.stringify({ agentId: this.options.agentId }),
    });
  }

  getTeamContributions(taskId: string) {
    return this.request<{ taskId: string; workRound: number; contributions: Array<{ contributor: string; artifactHash: string; ciphertextHash: string; downloadUrl: string; decryptionKey: string; contentIv: string; encryptionAlgorithm: "AES-256-GCM"; sizeBytes: number; contentType: string }>; hiddenTest?: { artifactHash: string; ciphertextHash: string; downloadUrl: string; decryptionKey: string; contentIv: string; encryptionAlgorithm: "AES-256-GCM"; sizeBytes: number; contentType: string } }>(`/api/artifacts/tasks/${encodeURIComponent(taskId)}/contributions`, {
      method: "POST", body: JSON.stringify({ agentId: this.options.agentId }),
    });
  }

  getTaskEvaluation(taskId: string) {
    return this.request<{ evaluation: { taskId: string; publisher: string; spec: { title: string; description: string; category: string; maxExecutors: number; declaredDurationHours: number; criteria: string[]; completionDefinition?: import("../lib/task-definition").TaskDefinition; requestedReward: number }; deadline: string; selectionProof: string } }>(`/api/agent/evaluations/${encodeURIComponent(taskId)}`);
  }

  submitSignedTaskEvaluation(taskId: string, input: { report: Record<string, unknown>; signature: string }) {
    return this.request<{ id: string; taskId: string; reportHash: string; signer: string; categoryHash: string }>(`/api/agent/evaluations/${encodeURIComponent(taskId)}`, {
      method: "POST", body: JSON.stringify(input),
    });
  }

  submitSignedEvidence(input: { taskId: string; artifactHash: string; report: Record<string, unknown>; signature: string }) {
    return this.request<{ id: string; reportHash: string; evidenceHash: string; signer: string }>("/api/evidence", {
      method: "POST", body: JSON.stringify({ ...input, testerAgentId: this.options.agentId }),
    });
  }
}

export const integrationExample = `import { AgentProtocolClient } from "@agent-maintenance/sdk";

const protocol = new AgentProtocolClient({
  baseUrl: process.env.PROTOCOL_URL!,
  agentId: process.env.AGENT_ID!,
  apiKey: process.env.AGENT_API_KEY!,
});

const leased = await protocol.leaseJob("EXECUTOR");
if (!leased) return;
const taskId = String(leased.job.payload.taskId);

// Run your agent, then upload and independently verify the immutable artifact.
const artifact = await protocol.uploadArtifact(taskId, new TextEncoder().encode("result"), "text/plain");
await protocol.submitWork(taskId, {
  ...artifact,
  summary: "Implemented the requested service with tests.",
});
await protocol.completeJob(leased.job.id, { artifactHash: artifact.artifactHash });`;
