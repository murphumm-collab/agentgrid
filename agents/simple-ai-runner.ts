import { createDecipheriv, createHash } from "node:crypto";
import { AgentProtocolClient } from "../src/sdk/client";
import { AgentGridDemoClient } from "../src/sdk/demo-client";
import { createPublicClient, createWalletClient, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { taskRegistryAbi } from "../src/lib/contracts";
import { chainContractAddresses, runtimeConfig } from "../src/lib/env";
import { buildAgentProjectArchive, parseAgentProjectManifest, readAgentProjectArchive } from "../src/lib/agent-artifact-builder";
import { approvedAiBaseUrl } from "../src/lib/ai-provider-policy";
import { readBoundedResponseBytes, readBoundedResponseText } from "../src/lib/outbound-response";
import { bscRpcTransport } from "../src/lib/bsc-rpc";
import { requiredConfigValue, requiredSecret } from "../src/lib/secrets";
import { collaborationAssemblyPrompt, collaborationExecutionPrompt } from "../src/lib/collaboration-execution";
import type { TaskDefinition } from "../src/lib/task-definition";

type OpenTask = {
  id: string;
  title: string;
  description: string;
  criteria: Array<{ description: string }>;
  state: string;
  executionMode?: "COLLABORATION" | "COMPETITION";
  executorIds?: string[];
  maxExecutors?: number;
  workRound?: number;
  completionDefinition?: TaskDefinition;
};
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

function required(name: string) {
  return ["AGENT_API_KEY", "AGENT_WALLET_PRIVATE_KEY", "AI_API_KEY"].includes(name)
    ? requiredSecret(name)
    : requiredConfigValue(name);
}

async function generateProject(task: OpenTask, collaborationContext?: string) {
  const aiBaseUrl = approvedAiBaseUrl(required("AI_BASE_URL"), process.env.AGENT_QUEUE_MODE === "true", process.env.AI_ALLOWED_ORIGINS);
  const response = await fetch(`${aiBaseUrl}/chat/completions`, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json", authorization: `Bearer ${required("AI_API_KEY")}` },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: required("AI_MODEL"), temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "Build a complete runnable Node.js project for the task.",
            "Return only JSON with this shape: {\"summary\":\"...\",\"files\":[{\"path\":\"package.json\",\"content\":\"...\"}]}.",
            "Put all application modules under src/ as side-effect-free JavaScript/ES modules, and deterministic node:test files under test/*.test.mjs. Include package.json.",
            "The independent tester ignores your test command and runs node --test --experimental-test-coverage itself with no network. Use only Node standard-library dependencies.",
            collaborationContext ? "Integrate the supplied independently committed team contributions into one coherent final project; do not merely copy one contribution." : "",
            "Do not use markdown fences and do not claim tests were run.",
          ].filter(Boolean).join(" "),
        },
        {
          role: "user",
          content: [
            `Task: ${task.title}`, task.description, "Acceptance criteria:",
            ...task.criteria.map((criterion, index) => `${index + 1}. ${criterion.description}`),
            collaborationContext ?? "",
          ].filter(Boolean).join("\n"),
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`AI_REQUEST_FAILED_${response.status}`);
  const text = await readBoundedResponseText(response, 2_000_000, {
    missingBody: "AI_RESPONSE_EMPTY",
    tooLarge: "AI_RESPONSE_TOO_LARGE",
    invalidContentLength: "AI_RESPONSE_INVALID_CONTENT_LENGTH",
    invalidUtf8: "AI_RESPONSE_INVALID_UTF8",
  });
  let body: { choices?: Array<{ message?: { content?: string } }> };
  try { body = JSON.parse(text) as typeof body; } catch { throw new Error("AI_RESPONSE_INVALID_JSON"); }
  const output = body.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error("AI returned an empty artifact");
  return parseAgentProjectManifest(output);
}

async function decryptContribution(input: { downloadUrl: string; artifactHash: string; ciphertextHash: string; decryptionKey: string; contentIv: string; sizeBytes: number }) {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 16) throw new Error("CONTRIBUTION_SIZE_INVALID");
  const response = await fetch(input.downloadUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`CONTRIBUTION_DOWNLOAD_FAILED_${response.status}`);
  const encrypted = Buffer.from(await readBoundedResponseBytes(response, input.sizeBytes, {
    missingBody: "CONTRIBUTION_DOWNLOAD_EMPTY",
    tooLarge: "CONTRIBUTION_DOWNLOAD_TOO_LARGE",
    invalidContentLength: "CONTRIBUTION_DOWNLOAD_INVALID_CONTENT_LENGTH",
  }));
  if (encrypted.byteLength !== input.sizeBytes) throw new Error("CONTRIBUTION_SIZE_MISMATCH");
  if (`sha256:${createHash("sha256").update(encrypted).digest("hex")}` !== input.ciphertextHash) throw new Error("CONTRIBUTION_CIPHERTEXT_HASH_MISMATCH");
  const tag = encrypted.subarray(encrypted.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(input.decryptionKey, "base64"), Buffer.from(input.contentIv, "base64"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  if (`sha256:${createHash("sha256").update(plaintext).digest("hex")}` !== input.artifactHash) throw new Error("CONTRIBUTION_PLAINTEXT_HASH_MISMATCH");
  return plaintext;
}

async function main() {
  const clientOptions = {
    baseUrl: required("PROTOCOL_URL"),
    agentId: required("AGENT_ID"),
    apiKey: required("AGENT_API_KEY"),
  };
  const protocol = new AgentProtocolClient(clientOptions);
  const productionQueue = process.env.AGENT_QUEUE_MODE === "true";
  const demo = productionQueue ? undefined : new AgentGridDemoClient(clientOptions);
  const leased = productionQueue ? await protocol.leaseJob("EXECUTOR") : null;
  if (leased) heartbeatTimer = setInterval(() => { void protocol.heartbeatJob(leased.job.id).catch(() => undefined); }, Math.max(5_000, Math.floor(leased.leaseSeconds * 1_000 / 3)));
  const assertLeaseCurrent = async () => { if (leased) await protocol.heartbeatJob(leased.job.id); };
  const taskId = leased ? String(leased.job.payload.taskId) : undefined;
  const { tasks } = await protocol.listTasks() as { tasks: OpenTask[] };
  const task = taskId ? tasks.find((candidate) => candidate.id === taskId) : tasks.find((candidate) => candidate.state === "OPEN");
  if (!task) { console.log("No open task is currently available."); return; }

  let chain: { account: ReturnType<typeof privateKeyToAccount>; publicClient: ReturnType<typeof createPublicClient>; wallet: ReturnType<typeof createWalletClient>; registry: `0x${string}` } | undefined;
  let claimedSlot: number | undefined;
  if (productionQueue) {
    const key = required("AGENT_WALLET_PRIVATE_KEY") as Hex;
    const account = privateKeyToAccount(key);
    const config = runtimeConfig();
    const transport = bscRpcTransport(config.BSC_TESTNET_RPC_URL);
    chain = { account, publicClient: createPublicClient({ chain: bscTestnet, transport }), wallet: createWalletClient({ account, chain: bscTestnet, transport }), registry: chainContractAddresses().taskRegistry };
    if (leased?.job.kind === "ASSEMBLE_TASK") {
      if (task.executionMode === "COMPETITION") throw new Error("COMPETITION_ASSEMBLY_FORBIDDEN");
      const team = await protocol.getTeamContributions(task.id);
      if (!team.contributions.length || team.contributions.length !== task.executorIds?.length) throw new Error("TEAM_CONTRIBUTIONS_INCOMPLETE");
      if (team.contributions.length === 1 && (task.maxExecutors ?? 1) === 1) {
        const artifact = team.contributions[0];
        await assertLeaseCurrent();
        const hash = await chain.wallet.writeContract({ address: chain.registry, abi: taskRegistryAbi, functionName: "submitWork", args: [BigInt(task.id), keccak256(stringToHex(artifact.artifactHash))] } as never);
        const receipt = await chain.publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
        if (receipt.status !== "success") throw new Error("CHAIN_SINGLE_MEMBER_TEAM_SUBMISSION_REVERTED");
        await protocol.completeJob(leased.job.id, { artifactHash: artifact.artifactHash, transactionHash: hash, contributions: 1 });
        return;
      }
      const assemblyContributions: Array<{ slot: number; contributor: string; manifest: unknown }> = [];
      let contextBytes = 0;
      for (const contribution of team.contributions) {
        const manifest = await readAgentProjectArchive(await decryptContribution(contribution));
        const serialized = JSON.stringify({ slot: contribution.slot, contributor: contribution.contributor, summary: manifest.summary, files: manifest.files });
        contextBytes += Buffer.byteLength(serialized);
        if (contextBytes > 2_000_000) throw new Error("TEAM_CONTRIBUTIONS_EXCEED_REFERENCE_ASSEMBLER_CONTEXT");
        assemblyContributions.push({ slot: contribution.slot, contributor: contribution.contributor, manifest: { summary: manifest.summary, files: manifest.files } });
      }
      if (!task.completionDefinition) throw new Error("COLLABORATION_PLAN_MISSING");
      const assemblyContext = collaborationAssemblyPrompt(task.completionDefinition, assemblyContributions);
      const manifest = await generateProject(task, `Work round ${team.workRound}.\n${assemblyContext}`);
      const archive = await buildAgentProjectArchive(manifest);
      await assertLeaseCurrent();
      const artifact = await protocol.uploadArtifact(task.id, archive);
      await assertLeaseCurrent();
      const hash = await chain.wallet.writeContract({
        address: chain.registry, abi: taskRegistryAbi, functionName: "submitWork",
        args: [BigInt(task.id), keccak256(stringToHex(artifact.artifactHash))],
      } as never);
      const receipt = await chain.publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
      if (receipt.status !== "success") throw new Error("CHAIN_TEAM_ASSEMBLY_SUBMISSION_REVERTED");
      await protocol.completeJob(leased.job.id, { artifactHash: artifact.artifactHash, transactionHash: hash, contributions: team.contributions.length });
      console.log(JSON.stringify({ taskId: task.id, artifactHash: artifact.artifactHash, contributors: team.contributions.length, status: "TEAM_ARTIFACT_SUBMITTED_FOR_INDEPENDENT_TESTING" }, null, 2));
      return;
    }
    if (leased?.job.kind !== "REVISE_TASK" && leased?.job.kind !== "REPAIR_MAINTENANCE") {
      await assertLeaseCurrent();
      const hash = await chain.wallet.writeContract({ address: chain.registry, abi: taskRegistryAbi, functionName: "claimTask", args: [BigInt(task.id)] } as never);
      const receipt = await chain.publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
      if (receipt.status !== "success") throw new Error("CHAIN_TASK_CLAIM_REVERTED");
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const projected = await protocol.listTasks() as { tasks: OpenTask[] };
        const indexed = projected.tasks.find((candidate) => candidate.id === task.id);
        const executorIndex = indexed?.executorIds?.findIndex((owner) => owner.toLowerCase() === account.address.toLowerCase()) ?? -1;
        if (executorIndex >= 0) { claimedSlot = executorIndex + 1; break; }
        if (attempt === 29) throw new Error("CHAIN_TASK_CLAIM_NOT_INDEXED");
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  } else {
    await demo!.claimTask(task.id);
  }
  const slot = claimedSlot ?? (leased ? Number(leased.job.payload.slot ?? 1) : 1);
  const executorSlots = leased ? Number(leased.job.payload.executorSlots ?? task.maxExecutors ?? 1) : 1;
  const manifest = await generateProject(task, leased?.job.kind === "REPAIR_MAINTENANCE"
    ? `This is maintenance repair round ${task.workRound ?? 1} for checkpoint ${String(leased.job.payload.checkpoint ?? "unknown")}. Produce a complete replacement artifact that preserves all acceptance criteria and fixes the independently detected maintenance regression committed as ${String(leased.job.payload.evidenceHash ?? "unknown")}.`
    : task.executionMode === "COMPETITION"
    ? `You are isolated competition candidate ${slot} of ${executorSlots}. Produce a complete standalone solution for every acceptance criterion. You cannot inspect other candidates and no lead will assemble your work.`
    : executorSlots > 1
    ? collaborationExecutionPrompt(task.completionDefinition, executorSlots, slot)
    : undefined);
  const archive = await buildAgentProjectArchive(manifest);

  let artifactHash: string;
  if (productionQueue && chain && leased) {
    await assertLeaseCurrent();
    const artifact = await protocol.uploadArtifact(task.id, archive);
    artifactHash = artifact.artifactHash;
    await assertLeaseCurrent();
    const contributionHash = await chain.wallet.writeContract({
      address: chain.registry, abi: taskRegistryAbi, functionName: "submitContribution",
      args: [BigInt(task.id), keccak256(stringToHex(artifact.artifactHash))],
    } as never);
    const contributionReceipt = await chain.publicClient.waitForTransactionReceipt({ hash: contributionHash, confirmations: runtimeConfig().CHAIN_CONFIRMATIONS });
    if (contributionReceipt.status !== "success") throw new Error("CHAIN_CONTRIBUTION_SUBMISSION_REVERTED");
    if (task.executionMode === "COMPETITION" || (task.maxExecutors ?? executorSlots) > 1) {
      await protocol.completeJob(leased.job.id, { artifactHash, contributionTransactionHash: contributionHash, slot });
      console.log(JSON.stringify({ taskId: task.id, artifactHash, slot, status: task.executionMode === "COMPETITION" ? "ISOLATED_CANDIDATE_COMMITTED" : "TEAM_CONTRIBUTION_COMMITTED" }, null, 2));
      return;
    }
    await assertLeaseCurrent();
    const hash = await chain.wallet.writeContract({
      address: chain.registry, abi: taskRegistryAbi, functionName: "submitWork",
      args: [BigInt(task.id), keccak256(stringToHex(artifact.artifactHash))],
    } as never);
    const receipt = await chain.publicClient.waitForTransactionReceipt({ hash, confirmations: runtimeConfig().CHAIN_CONFIRMATIONS });
    if (receipt.status !== "success") throw new Error("CHAIN_WORK_SUBMISSION_REVERTED");
    await protocol.completeJob(leased.job.id, { artifactHash, transactionHash: hash });
  } else {
    artifactHash = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    await demo!.submitWork(task.id, {
      artifactUrl: `data:application/gzip;base64,${Buffer.from(archive).toString("base64")}`,
      artifactHash,
      summary: `${manifest.summary} Generated by ${required("AI_MODEL")}; ${manifest.files.length} files; encrypted archive hash committed.`,
    });
  }
  console.log(JSON.stringify({ taskId: task.id, artifactHash, status: "SUBMITTED_FOR_INDEPENDENT_TESTING" }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => { if (heartbeatTimer) clearInterval(heartbeatTimer); });
