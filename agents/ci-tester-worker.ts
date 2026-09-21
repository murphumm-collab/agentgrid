import { createPublicClient, createWalletClient, http, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { AgentProtocolClient } from "../src/sdk/client";
import { completeAgentJob } from "../src/lib/agent-queue";
import { readAgentProjectArchive } from "../src/lib/agent-artifact-builder";
import { calculateContributionWeights, contributionFormulaVersion } from "../src/lib/contribution-weights";
import { competitionScoreBps, competitionWeightsBps } from "../src/lib/competition-scoring";
import { taskRegistryAbi, rewardVaultAbi } from "../src/lib/contracts";
import { chainContractAddresses, runtimeConfig } from "../src/lib/env";
import { decryptArtifactDownload, downloadAndRunSandbox } from "../src/lib/sandbox";
import { evidenceMessage } from "../src/lib/signed-evidence";
import { requiredConfigValue, requiredSecret } from "../src/lib/secrets";
import { automatedCriterionResults } from "../src/lib/criterion-verification";
import type { TaskDefinition } from "../src/lib/task-definition";

function required(name: string) { return ["AGENT_API_KEY", "AGENT_WALLET_PRIVATE_KEY"].includes(name) ? requiredSecret(name) : requiredConfigValue(name); }
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

async function main() {
  const protocol = new AgentProtocolClient({ baseUrl: required("PROTOCOL_URL"), agentId: required("AGENT_ID"), apiKey: required("AGENT_API_KEY") });
  const leased = await protocol.leaseJob("TESTER");
  if (!leased) { console.log("No assigned test job."); return; }
  heartbeatTimer = setInterval(() => { void protocol.heartbeatJob(leased.job.id).catch(() => undefined); }, Math.max(5_000, Math.floor(leased.leaseSeconds * 1_000 / 3)));
  const taskId = String(leased.job.payload.taskId);
  const task = ((await protocol.listTasks()).tasks as Array<{ id: string; executionMode?: "COLLABORATION" | "COMPETITION"; maintenanceRepairCheckpoint?: number | null; completionDefinition?: TaskDefinition }>).find((item) => item.id === taskId);
  if (!task) throw new Error("TEST_TASK_NOT_INDEXED");
  const account = privateKeyToAccount(required("AGENT_WALLET_PRIVATE_KEY") as Hex);
  const config = runtimeConfig();
  const transport = http(config.BSC_TESTNET_RPC_URL);
  const wallet = createWalletClient({ account, chain: bscTestnet, transport });
  const publicClient = createPublicClient({ chain: bscTestnet, transport });
  const checkpoint = leased.job.kind === "MAINTENANCE_VALIDATION" ? Number(leased.job.payload.checkpoint) : undefined;
  if (checkpoint) {
    const addresses = chainContractAddresses();
    const [current, grant] = await Promise.all([
      publicClient.readContract({ address: addresses.taskRegistry, abi: taskRegistryAbi, functionName: "tasks", args: [BigInt(taskId)] }),
      publicClient.readContract({ address: addresses.rewardVault, abi: rewardVaultAbi, functionName: "getGrant", args: [BigInt(taskId)] }),
    ]);
    if (checkpoint < 1 || checkpoint > 3 || current[19] !== 8 || current[2].toLowerCase() !== account.address.toLowerCase()
      || grant.approved[checkpoint] || current[17] !== leased.job.payload.workRound || current[7] !== leased.job.payload.artifactHash) {
      await completeAgentJob(leased.job.id, required("AGENT_ID"), { discarded: "STALE_MAINTENANCE_JOB" });
      return;
    }
  }
  const executors = await publicClient.readContract({ address: chainContractAddresses().taskRegistry, abi: taskRegistryAbi, functionName: "getTaskExecutors", args: [BigInt(taskId)] });
  const competition = !checkpoint && task.executionMode === "COMPETITION";
  let artifact: Awaited<ReturnType<typeof protocol.getArtifactForTesting>>;
  let report: Awaited<ReturnType<typeof downloadAndRunSandbox>>;
  let executorWeightsBps = [10_000];
  let contributionWork: ReturnType<typeof calculateContributionWeights> = [];
  let competitionResult: {
    winner: string | null;
    selectedArtifactHash: string | null;
    candidates: Array<{ contributor: string; artifactHash: string; passed: boolean; lineCoverage: number; branchCoverage: number; functionCoverage: number; criticalBranchCoverage: number; scoreBps: number }>;
  } | undefined;
  if (competition) {
    const candidateResponse = await protocol.getTeamContributions(taskId);
    if (!candidateResponse.hiddenTest) throw new Error("COMPETITION_HIDDEN_TEST_NOT_AVAILABLE");
    const byOwner = new Map(candidateResponse.contributions.map((item) => [item.contributor.toLowerCase(), item]));
    const ordered = executors.map((executor) => {
      const candidate = byOwner.get(executor.toLowerCase());
      if (!candidate) throw new Error(`MISSING_COMPETITION_CANDIDATE_${executor}`);
      return candidate;
    });
    const reports = [];
    for (const candidate of ordered) reports.push(await downloadAndRunSandbox({ ...candidate, hiddenTest: candidateResponse.hiddenTest }));
    const scores = reports.map(competitionScoreBps);
    const winnerIndex = scores.reduce((best, score, index) => score > scores[best] ? index : best, 0);
    const passed = scores.some((score) => score > 0);
    artifact = { ...ordered[passed ? winnerIndex : 0], hiddenTest: candidateResponse.hiddenTest };
    report = { ...reports[winnerIndex], passed };
    executorWeightsBps = passed ? competitionWeightsBps(scores, winnerIndex) : [];
    competitionResult = {
      winner: passed ? ordered[winnerIndex].contributor : null,
      selectedArtifactHash: passed ? ordered[winnerIndex].artifactHash : null,
      candidates: ordered.map((candidate, index) => ({
        contributor: candidate.contributor, artifactHash: candidate.artifactHash, passed: reports[index].passed,
        lineCoverage: reports[index].lineCoverage, branchCoverage: reports[index].branchCoverage,
        functionCoverage: reports[index].functionCoverage, criticalBranchCoverage: reports[index].criticalBranchCoverage,
        scoreBps: scores[index],
      })),
    };
  } else {
    artifact = await protocol.getArtifactForTesting(taskId);
    report = await downloadAndRunSandbox(artifact);
  }
  if (checkpoint) {
    executorWeightsBps = [...await publicClient.readContract({ address: chainContractAddresses().taskRegistry, abi: taskRegistryAbi, functionName: "getTaskExecutorWeightsBps", args: [BigInt(taskId)] })];
  } else if (executors.length > 1) {
    const contributionResponse = await protocol.getTeamContributions(taskId);
    const byOwner = new Map(contributionResponse.contributions.map((item) => [item.contributor.toLowerCase(), item]));
    const ordered = executors.map((executor) => {
      const contribution = byOwner.get(executor.toLowerCase());
      if (!contribution) throw new Error(`MISSING_COMMITTED_CONTRIBUTION_${executor}`);
      return contribution;
    });
    const [finalManifest, ...contributionManifests] = await Promise.all([
      decryptArtifactDownload(artifact).then(readAgentProjectArchive),
      ...ordered.map((item) => decryptArtifactDownload(item).then(readAgentProjectArchive)),
    ]);
    contributionWork = calculateContributionWeights(finalManifest, ordered.map((item, index) => ({ contributor: item.contributor, manifest: contributionManifests[index] })), executors[0]);
    executorWeightsBps = contributionWork.map((item) => item.weightBps);
  }
  const criterionResults = task.completionDefinition ? automatedCriterionResults(task.completionDefinition, report, artifact.artifactHash) : [];
  const finalPassed = report.passed && (!task.completionDefinition || task.completionDefinition.acceptanceCriteria.every((criterion, index) => !criterion.required || criterionResults[index]?.passed));
  const signedReport = { ...report, passed: finalPassed, criterionResults, contributionWork, contributionFormulaVersion, executorWeightsBps, ...(competitionResult ? { competition: competitionResult } : {}), ...(task.maintenanceRepairCheckpoint ? { maintenanceRepairCheckpoint: task.maintenanceRepairCheckpoint } : {}) };
  const commitment = evidenceMessage({ taskId, artifactHash: artifact.artifactHash, report: signedReport });
  const signature = await account.signMessage({ message: commitment.message });
  await protocol.heartbeatJob(leased.job.id);
  const evidence = await protocol.submitSignedEvidence({ taskId, artifactHash: artifact.artifactHash, report: signedReport as unknown as Record<string, unknown>, signature });
  await protocol.heartbeatJob(leased.job.id);
  const hash = checkpoint
    ? await wallet.writeContract({ address: chainContractAddresses().taskRegistry, abi: taskRegistryAbi, functionName: "validateMaintenance", args: [BigInt(taskId), checkpoint, finalPassed, evidence.evidenceHash as Hex] })
    : competition
      ? await wallet.writeContract({
        address: chainContractAddresses().taskRegistry, abi: taskRegistryAbi, functionName: "submitCompetitionTest",
        args: [BigInt(taskId), finalPassed, (competitionResult?.winner ?? `0x${"0".repeat(40)}`) as Hex,
          competitionResult?.selectedArtifactHash ? keccak256(stringToHex(competitionResult.selectedArtifactHash)) : `0x${"0".repeat(64)}`,
          evidence.evidenceHash as Hex, executorWeightsBps],
      })
    : await wallet.writeContract({ address: chainContractAddresses().taskRegistry, abi: taskRegistryAbi, functionName: "submitTest", args: [BigInt(taskId), finalPassed, evidence.evidenceHash as Hex, executorWeightsBps] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: config.CHAIN_CONFIRMATIONS });
  if (receipt.status !== "success") throw new Error("CHAIN_TEST_SUBMISSION_REVERTED");
  await completeAgentJob(leased.job.id, required("AGENT_ID"), { reportHash: evidence.reportHash, evidenceHash: evidence.evidenceHash, transactionHash: hash, passed: finalPassed });
  console.log(JSON.stringify({ taskId, checkpoint, passed: finalPassed, reportHash: evidence.reportHash, evidenceHash: evidence.evidenceHash, transactionHash: hash }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => { if (heartbeatTimer) clearInterval(heartbeatTimer); });
