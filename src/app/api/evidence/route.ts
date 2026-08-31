import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { authenticateAgent, protocolSnapshot } from "@/lib/service";
import { verifyEvidenceSignature } from "@/lib/signed-evidence";
import { readyArtifactsForTask, storeSignedTestEvidence } from "@/lib/store-postgres";
import { keccak256, stringToHex } from "viem";
import { competitionScoreBps, competitionWeightsBps } from "@/lib/competition-scoring";
import { contributionFormulaVersion } from "@/lib/contribution-weights";
import { evidenceJsonBodyLimit, readJsonBody } from "@/lib/request-body";
import { roleCanLease } from "@/lib/agent-roles";

const reportSchema = z.object({
  passed: z.boolean(), exitCode: z.number().int(), timedOut: z.boolean(), durationMs: z.number().int().nonnegative().max(11 * 60_000),
  testsPassed: z.boolean(), hiddenTestsPassed: z.boolean(), lineCoverage: z.number().min(0).max(1), branchCoverage: z.number().min(0).max(1),
  functionCoverage: z.number().min(0).max(1), criticalBranchCoverage: z.number().min(0).max(1),
  stdout: z.string().max(50_000), stderr: z.string().max(50_000),
  sandbox: z.object({ network: z.literal("none"), readOnlyRoot: z.literal(true), memoryMb: z.number().int().max(512), cpus: z.number().max(1), pids: z.number().int().max(128), image: z.string().min(1).max(200) }),
  contributionWork: z.array(z.object({
    contributor: z.string().regex(/^0x[0-9a-fA-F]{40}$/), acceptedBytes: z.number().int().nonnegative().max(5_750_000),
    acceptedFiles: z.number().int().nonnegative().max(100), weightBps: z.number().int().min(0).max(10_000),
  }).strict()).max(32),
  contributionFormulaVersion: z.literal(contributionFormulaVersion).optional(),
  executorWeightsBps: z.array(z.number().int().min(0).max(10_000)).max(32),
  competition: z.object({
    winner: z.string().regex(/^0x[0-9a-fA-F]{40}$/).nullable(),
    selectedArtifactHash: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
    candidates: z.array(z.object({
      contributor: z.string().regex(/^0x[0-9a-fA-F]{40}$/), artifactHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      passed: z.boolean(), lineCoverage: z.number().min(0).max(1), branchCoverage: z.number().min(0).max(1),
      functionCoverage: z.number().min(0).max(1), criticalBranchCoverage: z.number().min(0).max(1),
      scoreBps: z.number().int().min(0).max(10_000),
    }).strict()).min(1).max(32),
  }).strict().optional(),
  maintenanceRepairCheckpoint: z.number().int().min(1).max(3).optional(),
}).strict();
const schema = z.object({ taskId: z.string().regex(/^\d+$/), testerAgentId: z.string().min(3).max(120), artifactHash: z.string().regex(/^sha256:[0-9a-f]{64}$/), report: reportSchema, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await readJsonBody(request, evidenceJsonBodyLimit));
    const agent = await authenticateAgent(input.testerAgentId, request.headers.get("x-agent-key"), "tests:submit");
    if (!roleCanLease(agent.role, "TESTER")) throw new Error("AGENT_ROLE_DENIED");
    const task = (await protocolSnapshot()).tasks.find((item) => item.id === input.taskId);
    if (!task || task.testerId?.toLowerCase() !== agent.owner.toLowerCase()) throw new Error("TESTER_NOT_ASSIGNED");
    if (task.state !== "TESTING" && task.state !== "MAINTENANCE") throw new Error("TASK_NOT_ACCEPTING_EVIDENCE");
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
    const verified = await verifyEvidenceSignature({ ...input, signature: input.signature as `0x${string}`, expectedAddress: agent.owner });
    const evidence = await storeSignedTestEvidence({ id: randomUUID(), ...input, testerAddress: verified.signer, reportHash: verified.reportHash });
    const evidenceHash = keccak256(stringToHex(JSON.stringify({ reportHash: verified.reportHash, signer: verified.signer.toLowerCase(), signature: input.signature.toLowerCase() })));
    return NextResponse.json({ id: evidence.id, reportHash: verified.reportHash, evidenceHash, signer: verified.signer }, { status: 201 });
  } catch (error) { return apiError(error); }
}
