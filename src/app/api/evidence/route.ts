import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { authenticateAgent, protocolSnapshot } from "@/lib/service";
import { storedEvidenceHash, testEvidenceSigningVersion, verifyEvidenceSignature } from "@/lib/signed-evidence";
import { readyArtifactsForTask, storeSignedTestEvidence } from "@/lib/store-postgres";
import { keccak256, stringToHex } from "viem";
import { competitionScoreBps, competitionWeightsBps } from "@/lib/competition-scoring";
import { contributionFormulaVersion } from "@/lib/contribution-weights";
import { evidenceJsonBodyLimit, readJsonBody } from "@/lib/request-body";
import { roleCanLease } from "@/lib/agent-roles";
import { validateCriterionEvidenceBindings, validateCriterionSubset } from "@/lib/criterion-verification";
import { signedEvidenceSubmissionSchema } from "@/lib/test-evidence-schema";
import { chainContractAddresses, runtimeConfig } from "@/lib/env";

export async function POST(request: NextRequest) {
  try {
    const input = signedEvidenceSubmissionSchema.parse(await readJsonBody(request, evidenceJsonBodyLimit));
    const agent = await authenticateAgent(input.testerAgentId, request.headers.get("x-agent-key"), "tests:submit");
    if (!roleCanLease(agent.role, "TESTER")) throw new Error("AGENT_ROLE_DENIED");
    const task = (await protocolSnapshot()).tasks.find((item) => item.id === input.taskId);
    const testerIds = task?.testerIds?.length ? task.testerIds : task?.testerId ? [task.testerId] : [];
    const assignedShard = testerIds.findIndex((tester) => tester.toLowerCase() === agent.owner.toLowerCase());
    if (!task || assignedShard < 0) throw new Error("TESTER_NOT_ASSIGNED");
    if (input.verificationShard !== assignedShard) throw new Error("VERIFICATION_SHARD_MISMATCH");
    if (task.state !== "TESTING" && task.state !== "MAINTENANCE") throw new Error("TASK_NOT_ACCEPTING_EVIDENCE");
    const configuredRegistry = chainContractAddresses().taskRegistry;
    if (input.chainId !== runtimeConfig().BSC_CHAIN_ID) throw new Error("SIGNING_CHAIN_MISMATCH");
    if (input.taskRegistry.toLowerCase() !== configuredRegistry.toLowerCase()) throw new Error("SIGNING_TASK_REGISTRY_MISMATCH");
    if (input.workRound !== (task.workRound ?? 1)) throw new Error("EVIDENCE_WORK_ROUND_MISMATCH");
    if (input.executionMode !== task.executionMode) throw new Error("EVIDENCE_EXECUTION_MODE_MISMATCH");
    if (input.executorOrder.length !== task.executorIds.length || input.executorOrder.some((address, index) => address.toLowerCase() !== task.executorIds[index].toLowerCase())) throw new Error("EVIDENCE_EXECUTOR_ORDER_MISMATCH");
    const criterionResults = input.report.criterionResults ?? [];
    if (task.completionDefinition) {
      const shard = task.completionDefinition.verificationPlan?.shards[assignedShard];
      if (!shard) throw new Error("VERIFICATION_SHARD_NOT_COMMITTED");
      validateCriterionSubset(task.completionDefinition, shard.criterionIds, criterionResults, input.report.passed);
      validateCriterionEvidenceBindings(criterionResults, input.artifactHash);
    }
    else if (criterionResults.length) throw new Error("LEGACY_TASK_CRITERION_RESULTS_FORBIDDEN");
    const isCompetition = task.executionMode === "COMPETITION";
    if ((task.maintenanceRepairCheckpoint ?? undefined) !== input.report.maintenanceRepairCheckpoint) throw new Error("MAINTENANCE_REPAIR_CHECKPOINT_MISMATCH");
    if (!isCompetition && input.report.competition) throw new Error("COMPETITION_REPORT_FOR_COLLABORATION_TASK");
    if (isCompetition && !input.report.competition) throw new Error("COMPETITION_REPORT_REQUIRED");
    const weightsTotal = input.report.executorWeightsBps.reduce((sum, item) => sum + item, 0);
    if (input.report.passed) {
      if (input.report.executorWeightsBps.length !== task.executorIds.length || weightsTotal !== 10_000) throw new Error("INVALID_EXECUTOR_WEIGHTS");
    } else if (isCompetition && input.report.executorWeightsBps.length !== 0) throw new Error("FAILED_COMPETITION_WEIGHTS_MUST_BE_EMPTY");
    if (input.report.contributionWork.length && input.report.contributionFormulaVersion !== contributionFormulaVersion) throw new Error("CONTRIBUTION_FORMULA_VERSION_MISMATCH");
    if (input.report.contributionWork.length && (input.report.contributionWork.length !== task.executorIds.length || input.report.contributionWork.some((item, index) => item.contributor.toLowerCase() !== task.executorIds[index].toLowerCase() || item.weightBps !== input.report.executorWeightsBps[index]))) throw new Error("CONTRIBUTION_WORK_ORDER_MISMATCH");
    const artifacts = await readyArtifactsForTask(input.taskId);
    if (!artifacts.some((artifact) => input.artifactHash.toLowerCase() === `sha256:${artifact.plaintextSha256}`.toLowerCase())) throw new Error("EVIDENCE_ARTIFACT_MISMATCH");
    if (isCompetition) {
      const competition = input.report.competition!;
      if (competition.candidates.length !== task.executorIds.length || competition.candidates.some((candidate, index) => {
        if (candidate.contributor.toLowerCase() !== task.executorIds[index].toLowerCase()) return true;
        if (candidate.scoreBps !== competitionScoreBps(candidate)) return true;
        return task.contributionHashes?.[candidate.contributor.toLowerCase()]?.toLowerCase() !== keccak256(stringToHex(candidate.artifactHash)).toLowerCase();
      })) throw new Error("COMPETITION_CANDIDATE_COMMITMENT_MISMATCH");
      if (input.report.passed) {
        const winner = competition.candidates.find((candidate) => candidate.contributor.toLowerCase() === competition.winner?.toLowerCase());
        if (!winner?.passed || winner.artifactHash !== competition.selectedArtifactHash || input.artifactHash !== competition.selectedArtifactHash) throw new Error("COMPETITION_WINNER_MISMATCH");
        if (competition.candidates.some((candidate) => candidate.scoreBps > winner.scoreBps)) throw new Error("COMPETITION_WINNER_NOT_HIGHEST_SCORE");
        const winnerIndex = competition.candidates.indexOf(winner);
        const expectedWeights = competitionWeightsBps(competition.candidates.map((candidate) => candidate.scoreBps), winnerIndex);
        if (expectedWeights.some((weight, index) => weight !== input.report.executorWeightsBps[index])) throw new Error("COMPETITION_WEIGHT_FORMULA_MISMATCH");
      } else if (competition.winner !== null || competition.selectedArtifactHash !== null || competition.candidates.some((candidate) => candidate.passed)) throw new Error("FAILED_COMPETITION_RESULT_INVALID");
    } else {
      const chainCommitment = keccak256(stringToHex(input.artifactHash));
      if (!task.submission || task.submission.artifactHash.toLowerCase() !== chainCommitment.toLowerCase()) throw new Error("EVIDENCE_CHAIN_COMMITMENT_MISMATCH");
    }
    const verified = await verifyEvidenceSignature({
      chainId: input.chainId, taskRegistry: input.taskRegistry, taskId: input.taskId, workRound: input.workRound,
      verificationShard: input.verificationShard,
      executionMode: input.executionMode, executorOrder: input.executorOrder, artifactHash: input.artifactHash,
      report: input.report, signature: input.signature as `0x${string}`, expectedAddress: agent.owner,
    });
    const evidence = await storeSignedTestEvidence({
      id: randomUUID(), ...input, testerAddress: verified.signer, reportHash: verified.reportHash,
      signingVersion: testEvidenceSigningVersion, signingMessage: verified.message,
    });
    const evidenceHash = storedEvidenceHash(evidence);
    return NextResponse.json({ id: evidence.id, reportHash: evidence.reportHash, evidenceHash, signer: evidence.testerAddress }, { status: 201 });
  } catch (error) { return apiError(error); }
}
