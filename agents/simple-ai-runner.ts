import { createDecipheriv, createHash } from "node:crypto";
import { AgentProtocolClient } from "../src/sdk/client";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { taskRegistryAbi } from "../src/lib/contracts";
import { chainContractAddresses, runtimeConfig } from "../src/lib/env";
import { buildAgentProjectArchive, parseAgentProjectManifest, readAgentProjectArchive } from "../src/lib/agent-artifact-builder";
import { approvedAiBaseUrl } from "../src/lib/ai-provider-policy";
import { requiredConfigValue, requiredSecret } from "../src/lib/secrets";

type OpenTask = {
  id: string;
  title: string;
  description: string;
  criteria: Array<{ description: string }>;
  state: string;
  executionMode?: "COLLABORATION" | "COMPETITION";
  executorIds?: string[];
  maxExecutors?: number;
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
    headers: { "content-type": "application/json", authorization: `Bearer ${required("AI_API_KEY")}` },
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
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const output = body.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error("AI returned an empty artifact");
  return parseAgentProjectManifest(output);
}

async function decryptContribution(input: { downloadUrl: string; artifactHash: string; ciphertextHash: string; decryptionKey: string; contentIv: string }) {
  const response = await fetch(input.downloadUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`CONTRIBUTION_DOWNLOAD_FAILED_${response.status}`);
  const encrypted = Buffer.from(await response.arrayBuffer());
  if (`sha256:${createHash("sha256").update(encrypted).digest("hex")}` !== input.ciphertextHash) throw new Error("CONTRIBUTION_CIPHERTEXT_HASH_MISMATCH");
  const tag = encrypted.subarray(encrypted.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(input.decryptionKey, "base64"), Buffer.from(input.contentIv, "base64"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  if (`sha256:${createHash("sha256").update(plaintext).digest("hex")}` !== input.artifactHash) throw new Error("CONTRIBUTION_PLAINTEXT_HASH_MISMATCH");
  return plaintext;
}

async function main() {
  const protocol = new AgentProtocolClient({
    baseUrl: required("PROTOCOL_URL"),
    agentId: required("AGENT_ID"),
    apiKey: required("AGENT_API_KEY"),
  });
  const productionQueue = process.env.AGENT_QUEUE_MODE === "true";
  const leased = productionQueue ? await protocol.leaseJob("EXECUTOR") : null;
  if (leased) heartbeatTimer = setInterval(() => { void protocol.heartbeatJob(leased.job.id).catch(() => undefined); }, Math.max(5_000, Math.floor(leased.leaseSeconds * 1_000 / 3)));
  const assertLeaseCurrent = async () => { if (leased) await protocol.heartbeatJob(leased.job.id); };
  const taskId = leased ? String(leased.job.payload.taskId) : undefined;
  const { tasks } = await protocol.listTasks() as { tasks: OpenTask[] };
  const task = taskId ? tasks.find((candidate) => candidate.id === taskId) : tasks.find((candidate) => candidate.state === "OPEN");
  if (!task) { console.log("No open task is currently available."); return; }

  let chain: { account: ReturnType<typeof privateKeyToAccount>; publicClient: ReturnType<typeof createPublicClient>; wallet: ReturnType<typeof createWalletClient>; registry: `0x${string}` } | undefined;
  if (productionQueue) {
    const key = required("AGENT_WALLET_PRIVATE_KEY") as Hex;
    const account = privateKeyToAccount(key);
    const config = runtimeConfig();
    const transport = http(config.BSC_TESTNET_RPC_URL);
    chain = { account, publicClient: createPublicClient({ chain: bscTestnet, transport }), wallet: createWalletClient({ account, chain: bscTestnet, transport }), registry: chainContractAddresses().taskRegistry };
    if (leased?.job.kind === "ASSEMBLE_TASK") {
      if (task.executionMode === "COMPETITION") throw new Error("COMPETITION_ASSEMBLY_FORBIDDEN");
      const team = await protocol.getTeamContributions(task.id);
      if (!team.contributions.length || team.contributions.length !== task.executorIds?.length) throw new Error("TEAM_CONTRIBUTIONS_INCOMPLETE");
      if (team.contributions.length === 1) {
        const artifact = team.contributions[0];
        await assertLeaseCurrent();
        const hash = await chain.wallet.writeContract({ address: chain.registry, abi: taskRegistryAbi, functionName: "submitWork", args: [BigInt(task.id), keccak256(stringToHex(artifact.artifactHash))] } as never);
        const receipt = await chain.publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
        if (receipt.status !== "success") throw new Error("CHAIN_SINGLE_MEMBER_TEAM_SUBMISSION_REVERTED");
        await protocol.completeJob(leased.job.id, { artifactHash: artifact.artifactHash, transactionHash: hash, contributions: 1 });
        return;
      }
      const contributions: string[] = [];
      let contextBytes = 0;
      for (const contribution of team.contributions) {
        const manifest = await readAgentProjectArchive(await decryptContribution(contribution));
        const serialized = JSON.stringify({ contributor: contribution.contributor, summary: manifest.summary, files: manifest.files });
        contextBytes += Buffer.byteLength(serialized);
        if (contextBytes > 2_000_000) throw new Error("TEAM_CONTRIBUTIONS_EXCEED_REFERENCE_ASSEMBLER_CONTEXT");
        contributions.push(serialized);
      }
      const manifest = await generateProject(task, `Independently committed contributions for work round ${team.workRound}:\n${contributions.join("\n")}`);
      const archive = await buildAgentProjectArchive(manifest);
      await assertLeaseCurrent();
      const artifact = await protocol.uploadArtifact(task.id, archive, "application/gzip");
      await assertLeaseCurrent();
      const hash = await chain.wallet.writeContract({
        address: chain.registry, abi: taskRegistryAbi, functionName: "submitWork",
        args: [BigInt(task.id), keccak256(stringToHex(artifact.artifactHash))],
      } as never);
      const receipt = await chain.publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
      if (receipt.status !== "success") throw new Error("CHAIN_TEAM_ASSEMBLY_SUBMISSION_REVERTED");
      await protocol.completeJob(leased.job.id, { artifactUrl: artifact.artifactUrl, artifactHash: artifact.artifactHash, transactionHash: hash, contributions: team.contributions.length });
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
        if (indexed?.executorIds?.some((owner) => owner.toLowerCase() === account.address.toLowerCase())) break;
        if (attempt === 29) throw new Error("CHAIN_TASK_CLAIM_NOT_INDEXED");
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  } else {
    await protocol.claimTask(task.id);
  }
  const slot = leased ? Number(leased.job.payload.slot ?? 1) : 1;
  const executorSlots = leased ? Number(leased.job.payload.executorSlots ?? task.maxExecutors ?? 1) : 1;
  const manifest = await generateProject(task, leased?.job.kind === "REPAIR_MAINTENANCE"
    ? `This is maintenance repair round ${task.workRound ?? 1} for checkpoint ${String(leased.job.payload.checkpoint ?? "unknown")}. Produce a complete replacement artifact that preserves all acceptance criteria and fixes the independently detected maintenance regression committed as ${String(leased.job.payload.evidenceHash ?? "unknown")}.`
    : task.executionMode === "COMPETITION"
    ? `You are isolated competition candidate ${slot} of ${executorSlots}. Produce a complete standalone solution for every acceptance criterion. You cannot inspect other candidates and no lead will assemble your work.`
    : executorSlots > 1
    ? `You are execution slot ${slot} of ${executorSlots}. Produce a distinct, runnable contribution focused on one coherent part of the acceptance criteria; the lead assembler will integrate all independently committed archives.`
    : undefined);
  const archive = await buildAgentProjectArchive(manifest);

  let artifactHash: string;
  if (productionQueue && chain && leased) {
    await assertLeaseCurrent();
    const artifact = await protocol.uploadArtifact(task.id, archive, "application/gzip");
    artifactHash = artifact.artifactHash;
    await assertLeaseCurrent();
    const contributionHash = await chain.wallet.writeContract({
      address: chain.registry, abi: taskRegistryAbi, functionName: "submitContribution",
      args: [BigInt(task.id), keccak256(stringToHex(artifact.artifactHash))],
    } as never);
    const contributionReceipt = await chain.publicClient.waitForTransactionReceipt({ hash: contributionHash, confirmations: runtimeConfig().CHAIN_CONFIRMATIONS });
    if (contributionReceipt.status !== "success") throw new Error("CHAIN_CONTRIBUTION_SUBMISSION_REVERTED");
    if (task.executionMode === "COMPETITION" || (task.maxExecutors ?? executorSlots) > 1) {
      await protocol.completeJob(leased.job.id, { artifactUrl: artifact.artifactUrl, artifactHash, contributionTransactionHash: contributionHash, slot });
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
    await protocol.completeJob(leased.job.id, { artifactUrl: artifact.artifactUrl, artifactHash, transactionHash: hash });
  } else {
    artifactHash = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    await protocol.submitWork(task.id, {
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
