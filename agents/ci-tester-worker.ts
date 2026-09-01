import { createPublicClient, createWalletClient, encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { AgentProtocolClient } from "../src/sdk/client";
import { readAgentProjectArchive } from "../src/lib/agent-artifact-builder";
import { calculateContributionWeights, contributionFormulaVersion } from "../src/lib/contribution-weights";
import { competitionScoreBps, competitionWeightsBps } from "../src/lib/competition-scoring";
import { taskRegistryAbi, verificationPanelAbi } from "../src/lib/contracts";
import { chainContractAddresses, runtimeConfig } from "../src/lib/env";
import { decryptArtifactDownload, downloadAndRunSandbox } from "../src/lib/sandbox";
import { evidenceMessage } from "../src/lib/signed-evidence";
import { requiredConfigValue, requiredSecret } from "../src/lib/secrets";
import { automatedCriterionResults } from "../src/lib/criterion-verification";
import type { TaskDefinition } from "../src/lib/task-definition";
import { bscRpcTransport } from "../src/lib/bsc-rpc";

function required(name: string) { return ["AGENT_API_KEY", "AGENT_WALLET_PRIVATE_KEY"].includes(name) ? requiredSecret(name) : requiredConfigValue(name); }
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

async function main() {
  const protocol = new AgentProtocolClient({ baseUrl: required("PROTOCOL_URL"), agentId: required("AGENT_ID"), apiKey: required("AGENT_API_KEY") });
  const leased = await protocol.leaseJob("TESTER");
  if (!leased) { console.log("No assigned test job."); return; }
  heartbeatTimer = setInterval(() => { void protocol.heartbeatJob(leased.job.id).catch(() => undefined); }, Math.max(5_000, Math.floor(leased.leaseSeconds * 1_000 / 3)));
  const taskId = String(leased.job.payload.taskId);
  const verificationShard = Number(leased.job.payload.shard);
  if (!Number.isInteger(verificationShard) || verificationShard < 0 || verificationShard > 2) throw new Error("VERIFICATION_SHARD_MISSING");
  const task = ((await protocol.listTasks()).tasks as Array<{ id: string; workRound?: number; executionMode?: "COLLABORATION" | "COMPETITION"; maintenanceRepairCheckpoint?: number | null; completionDefinition?: TaskDefinition }>).find((item) => item.id === taskId);
  if (!task) throw new Error("TEST_TASK_NOT_INDEXED");
  const account = privateKeyToAccount(required("AGENT_WALLET_PRIVATE_KEY") as Hex);
  const config = runtimeConfig();
  const transport = bscRpcTransport(config.BSC_TESTNET_RPC_URL);
  const wallet = createWalletClient({ account, chain: bscTestnet, transport });
  const publicClient = createPublicClient({ chain: bscTestnet, transport });
  const panelAddress = await publicClient.readContract({ address: chainContractAddresses().taskRegistry, abi: taskRegistryAbi, functionName: "verificationPanel" });
  const activePanel = await publicClient.readContract({ address: panelAddress, abi: verificationPanelAbi, functionName: "getPanel", args: [BigInt(taskId)] });
  const checkpoint = Number(activePanel.checkpoint);
  const panelEpoch = Number(activePanel.epoch);
  if (![1, 2, 3].includes(Number(activePanel.status))) throw new Error("VERIFICATION_PANEL_NOT_ACCEPTING_WORK");
  if (Number(activePanel.workRound) !== (task.workRound ?? 1)) throw new Error("VERIFICATION_PANEL_WORK_ROUND_MISMATCH");
  if (activePanel.testers[verificationShard].toLowerCase() !== account.address.toLowerCase()) throw new Error("VERIFICATION_PANEL_SHARD_OWNER_MISMATCH");
  if (leased.job.kind === "REVEAL_TEST_SHARD") {
    const payload = leased.job.payload;
    if (payload.workRound !== Number(activePanel.workRound) || payload.checkpoint !== checkpoint || payload.panelEpoch !== panelEpoch || payload.shard !== verificationShard) {
      throw new Error("VERIFICATION_REVEAL_JOB_PANEL_MISMATCH");
    }
    const shardCommitment = keccak256(encodeAbiParameters([
      { type: "uint256" }, { type: "uint32" }, { type: "uint8" }, { type: "uint8" }, { type: "uint16" },
      { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint16[]" }, { type: "bytes32" },
    ], [BigInt(taskId), payload.workRound, payload.checkpoint, payload.shard, payload.criterionPassMask, payload.winner, payload.selectedArtifactHash, payload.evidenceHash, payload.passed ? payload.executorWeightsBps : [], payload.salt]));
    const existingReport = await publicClient.readContract({ address: panelAddress, abi: verificationPanelAbi, functionName: "getReport", args: [BigInt(taskId), account.address] });
    if (existingReport.commitment.toLowerCase() !== shardCommitment.toLowerCase()) throw new Error("VERIFICATION_REVEAL_COMMITMENT_MISMATCH");
    if (existingReport.revealed) {
      await protocol.completeJob(leased.job.id, { reportHash: payload.reportHash, evidenceHash: payload.evidenceHash, alreadyRevealed: true, passed: payload.passed });
      return;
    }
    if (Number(activePanel.status) !== 2) throw new Error("VERIFICATION_PANEL_REVEAL_NOT_READY");
    const revealHash = await wallet.writeContract({
      address: panelAddress, abi: verificationPanelAbi, functionName: "revealShard",
      args: [BigInt(taskId), payload.criterionPassMask, payload.winner, payload.selectedArtifactHash, payload.evidenceHash, payload.passed ? payload.executorWeightsBps : [], payload.salt],
    });
    const revealReceipt = await publicClient.waitForTransactionReceipt({ hash: revealHash, confirmations: config.CHAIN_CONFIRMATIONS });
    if (revealReceipt.status !== "success") throw new Error("CHAIN_TEST_REVEAL_REVERTED");
    await protocol.completeJob(leased.job.id, { reportHash: payload.reportHash, evidenceHash: payload.evidenceHash, transactionHash: revealHash, passed: payload.passed });
    console.log(JSON.stringify({ taskId, checkpoint, panelEpoch, shard: verificationShard, phase: "reveal", transactionHash: revealHash }));
    return;
  }
  const executors = await publicClient.readContract({ address: chainContractAddresses().taskRegistry, abi: taskRegistryAbi, functionName: "getTaskExecutors", args: [BigInt(taskId)] });
  const competition = checkpoint === 0 && task.executionMode === "COMPETITION";
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
  if (checkpoint > 0) {
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
  const allowedCriterionIds = task.completionDefinition?.verificationPlan?.shards[verificationShard]?.criterionIds;
  if (!allowedCriterionIds) throw new Error("VERIFICATION_SHARD_NOT_COMMITTED");
  const criterionResults = task.completionDefinition ? automatedCriterionResults(task.completionDefinition, report, artifact.artifactHash).filter((result) => allowedCriterionIds.includes(result.criterionId)) : [];
  const finalPassed = report.passed && criterionResults.every((result) => result.passed);
  const signedReport = { ...report, passed: finalPassed, criterionResults, contributionWork, contributionFormulaVersion, executorWeightsBps, ...(competitionResult ? { competition: competitionResult } : {}), ...(checkpoint > 0 ? { maintenanceRepairCheckpoint: checkpoint } : {}) };
  const signingDomain = {
    chainId: config.BSC_CHAIN_ID, taskRegistry: chainContractAddresses().taskRegistry, taskId,
    checkpoint, panelEpoch, verificationShard,
    workRound: task.workRound ?? 1, executionMode: task.executionMode ?? "COLLABORATION", executorOrder: [...executors],
    artifactHash: artifact.artifactHash, report: signedReport,
  } as const;
  const commitment = evidenceMessage(signingDomain);
  const signature = await account.signMessage({ message: commitment.message });
  await protocol.heartbeatJob(leased.job.id);
  const evidence = await protocol.submitSignedEvidence({ ...signingDomain, report: signedReport as unknown as Record<string, unknown>, signature });
  await protocol.heartbeatJob(leased.job.id);
  const criterionPassMask = criterionResults.reduce((mask, result) => result.passed ? mask | (1 << (Number(result.criterionId.split("-")[1]) - 1)) : mask, 0);
  const winner = (competitionResult?.winner ?? `0x${"0".repeat(40)}`) as Hex;
  const selectedArtifactHash = competitionResult?.selectedArtifactHash ? keccak256(stringToHex(competitionResult.selectedArtifactHash)) : `0x${"0".repeat(64)}` as Hex;
  // Deterministic recovery secret: the signed evidence is durable and an
  // idempotent retry recreates this salt after a crash between commit/reveal.
  // Other validators cannot derive it from the public commitment.
  const salt = keccak256(signature as Hex);
  const shardCommitment = keccak256(encodeAbiParameters([
    { type: "uint256" }, { type: "uint32" }, { type: "uint8" }, { type: "uint8" }, { type: "uint16" },
    { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint16[]" }, { type: "bytes32" },
  ], [BigInt(taskId), task.workRound ?? 1, checkpoint, verificationShard, criterionPassMask, winner, selectedArtifactHash, evidence.evidenceHash as Hex, finalPassed ? executorWeightsBps : [], salt]));
  const existingReport = await publicClient.readContract({ address: panelAddress, abi: verificationPanelAbi, functionName: "getReport", args: [BigInt(taskId), account.address] });
  if (existingReport.commitment !== `0x${"0".repeat(64)}` && existingReport.commitment.toLowerCase() !== shardCommitment.toLowerCase()) throw new Error("VERIFICATION_COMMITMENT_CONFLICT");
  if (existingReport.commitment === `0x${"0".repeat(64)}`) {
    const commitHash = await wallet.writeContract({ address: panelAddress, abi: verificationPanelAbi, functionName: "commitShard", args: [BigInt(taskId), shardCommitment] });
    const commitReceipt = await publicClient.waitForTransactionReceipt({ hash: commitHash, confirmations: config.CHAIN_CONFIRMATIONS });
    if (commitReceipt.status !== "success") throw new Error("CHAIN_TEST_COMMIT_REVERTED");
    await protocol.completeJob(leased.job.id, { reportHash: evidence.reportHash, evidenceHash: evidence.evidenceHash, transactionHash: commitHash, passed: finalPassed });
    console.log(JSON.stringify({ taskId, checkpoint, panelEpoch, shard: verificationShard, phase: "commit", passed: finalPassed, reportHash: evidence.reportHash, evidenceHash: evidence.evidenceHash, transactionHash: commitHash }));
    return;
  }
  await protocol.completeJob(leased.job.id, { reportHash: evidence.reportHash, evidenceHash: evidence.evidenceHash, alreadyCommitted: true, passed: finalPassed });
  console.log(JSON.stringify({ taskId, checkpoint, panelEpoch, shard: verificationShard, phase: "commit", alreadyCommitted: true, reportHash: evidence.reportHash, evidenceHash: evidence.evidenceHash }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => { if (heartbeatTimer) clearInterval(heartbeatTimer); });
