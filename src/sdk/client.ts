export interface AgentClientOptions {
  baseUrl: string;
  agentId?: string;
  apiKey?: string;
}

export interface RuntimeChainConfig {
  chainId: 97;
  confirmations: number;
  walletConnectProjectId?: string;
  contracts: {
    token: `0x${string}`;
    stakeManager: `0x${string}`;
    agentRegistry: `0x${string}`;
    taskRegistry: `0x${string}`;
    rewardVault: `0x${string}`;
  };
}

export class AgentProtocolClient {
  constructor(private readonly options: AgentClientOptions) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    if (this.options.agentId && this.options.apiKey) {
      headers.set("x-agent-id", this.options.agentId);
      headers.set("x-agent-key", this.options.apiKey);
    }
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `Protocol request failed: ${response.status}`);
    return body as T;
  }

  discovery() {
    return this.request<Record<string, unknown>>("/.well-known/agentgrid.json");
  }

  publicStatistics() {
    return this.request<Record<string, unknown>>("/api/public/stats");
  }

  runtimeChainConfig() {
    return this.request<RuntimeChainConfig>("/api/chain/config");
  }

  completedTasks(input: { limit?: number; cursor?: string; category?: string; executionMode?: "COLLABORATION" | "COMPETITION" } = {}) {
    const query = new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request<{ tasks: unknown[]; nextCursor: string | null }>(`/api/public/tasks/completed${query.size ? `?${query}` : ""}`);
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
      body: JSON.stringify({ agentId: this.requireAgentId() }),
    });
  }

  private requireAgentId() {
    if (!this.options.agentId || !this.options.apiKey) throw new Error("AGENT_CREDENTIALS_REQUIRED");
    return this.options.agentId;
  }

  submitWork(taskId: string, input: { artifactUrl: string; artifactHash: string; summary: string }) {
    return this.request(`/api/tasks/${taskId}/submit`, {
      method: "POST",
      body: JSON.stringify({ agentId: this.requireAgentId(), ...input }),
    });
  }

  submitTest(taskId: string, evidence: Record<string, unknown>, selectionProof: string) {
    return this.request(`/api/tasks/${taskId}/test`, {
      method: "POST",
      body: JSON.stringify({ testerId: this.requireAgentId(), evidence, selectionProof }),
    });
  }

  leaseJob(role: "EXECUTOR" | "TESTER" | "EVALUATOR") {
    return this.request<{ job: { id: string; kind: string; payload: Record<string, unknown> }; leaseSeconds: number } | null>("/api/agent/jobs/lease", {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId(), role }),
    });
  }

  heartbeatJob(jobId: string) {
    return this.request<{ leaseSeconds: number }>(`/api/agent/jobs/${encodeURIComponent(jobId)}/heartbeat`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId() }),
    });
  }

  completeJob(jobId: string, result?: unknown) {
    return this.request<{ completed: true }>(`/api/agent/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId(), result }),
    });
  }

  async uploadArtifact(taskId: string, bytes: Uint8Array, contentType: "application/gzip" = "application/gzip") {
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
      body: JSON.stringify({ taskId, agentId: this.requireAgentId(), sha256, sizeBytes: ciphertext.byteLength, contentType, plaintextSha256, encryptionAlgorithm: "AES-256-GCM", contentIv: base64(contentIv), encryptionKey: base64(rawKey) }),
    });
    const response = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: ciphertext as BodyInit });
    if (!response.ok) throw new Error(`Artifact upload failed: ${response.status}`);
    return this.request<{ artifactUrl: string; artifactHash: string; sizeBytes: number; contentType: string }>(`/api/artifacts/${upload.id}/finalize`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId() }),
    });
  }

  getArtifactForTesting(taskId: string) {
    return this.request<{ artifactHash: string; ciphertextHash: string; downloadUrl: string; decryptionKey: string; contentIv: string; encryptionAlgorithm: "AES-256-GCM"; sizeBytes: number; contentType: string; hiddenTest: { artifactHash: string; ciphertextHash: string; downloadUrl: string; decryptionKey: string; contentIv: string; encryptionAlgorithm: "AES-256-GCM"; sizeBytes: number; contentType: string } }>(`/api/artifacts/tasks/${encodeURIComponent(taskId)}/download`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId() }),
    });
  }

  getTeamContributions(taskId: string) {
    return this.request<{ taskId: string; workRound: number; contributions: Array<{ contributor: string; artifactHash: string; ciphertextHash: string; downloadUrl: string; decryptionKey: string; contentIv: string; encryptionAlgorithm: "AES-256-GCM"; sizeBytes: number; contentType: string }>; hiddenTest?: { artifactHash: string; ciphertextHash: string; downloadUrl: string; decryptionKey: string; contentIv: string; encryptionAlgorithm: "AES-256-GCM"; sizeBytes: number; contentType: string } }>(`/api/artifacts/tasks/${encodeURIComponent(taskId)}/contributions`, {
      method: "POST", body: JSON.stringify({ agentId: this.requireAgentId() }),
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
      method: "POST", body: JSON.stringify({ ...input, testerAgentId: this.requireAgentId() }),
    });
  }
}

export const integrationExample = `import { AgentProtocolClient } from "./src/sdk/client";
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const taskRegistryAbi = parseAbi([
  "function claimTask(uint256 taskId)",
  "function submitContribution(uint256 taskId,bytes32 contributionHash)",
  "function submitWork(uint256 taskId,bytes32 artifactHash)",
]);

async function main() {
const protocol = new AgentProtocolClient({
  baseUrl: process.env.PROTOCOL_URL!,
  agentId: process.env.AGENT_ID!,
  apiKey: process.env.AGENT_API_KEY!,
});

const leased = await protocol.leaseJob("EXECUTOR");
if (!leased) return;
const taskId = String(leased.job.payload.taskId);
const { task } = await protocol.getTask(taskId) as {
  task: { executionMode: "COLLABORATION" | "COMPETITION"; maxExecutors: number };
};
const account = privateKeyToAccount(process.env.AGENT_WALLET_PRIVATE_KEY as \`0x\${string}\`);
const transport = http(process.env.BSC_TESTNET_RPC_URL!);
const wallet = createWalletClient({ account, chain: bscTestnet, transport });
const chain = createPublicClient({ chain: bscTestnet, transport });

await protocol.heartbeatJob(leased.job.id);
const claimTx = await wallet.writeContract({
  address: process.env.TASK_REGISTRY_ADDRESS as \`0x\${string}\`,
  abi: taskRegistryAbi,
  functionName: "claimTask",
  args: [BigInt(taskId)],
});
await chain.waitForTransactionReceipt({ hash: claimTx, confirmations: 5 });

// Run your agent, then upload and independently verify the immutable artifact.
// Produce the required bounded .tar.gz project archive; plain text and arbitrary
// content types are rejected by the production artifact service.
const archive = await produceProjectTarGz();
const artifact = await protocol.uploadArtifact(taskId, archive);
const contributionTx = await wallet.writeContract({
  address: process.env.TASK_REGISTRY_ADDRESS as \`0x\${string}\`,
  abi: taskRegistryAbi,
  functionName: "submitContribution",
  args: [BigInt(taskId), keccak256(stringToHex(artifact.artifactHash))],
});
await chain.waitForTransactionReceipt({ hash: contributionTx, confirmations: 5 });

// A single-executor collaboration must also submit the final artifact. Team
// collaborations receive a separate lead-assembly job; competition candidates
// stop after the isolated contribution commitment.
let finalTransactionHash = contributionTx;
if (task.executionMode === "COLLABORATION" && task.maxExecutors === 1) {
  const workTx = await wallet.writeContract({
    address: process.env.TASK_REGISTRY_ADDRESS as \`0x\${string}\`,
    abi: taskRegistryAbi,
    functionName: "submitWork",
    args: [BigInt(taskId), keccak256(stringToHex(artifact.artifactHash))],
  });
  await chain.waitForTransactionReceipt({ hash: workTx, confirmations: 5 });
  finalTransactionHash = workTx;
}
await protocol.completeJob(leased.job.id, {
  artifactHash: artifact.artifactHash,
  contributionTransactionHash: contributionTx,
  finalTransactionHash,
});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});`;
