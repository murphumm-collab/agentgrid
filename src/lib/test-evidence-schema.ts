import { z } from "zod";
import { contributionFormulaVersion } from "./contribution-weights";
import { criterionVerificationResultsSchema } from "./criterion-verification";
import { walletAddressSchema } from "./auth-schema";

export const testEvidenceReportSchema = z.object({
  passed: z.boolean(), exitCode: z.number().int(), timedOut: z.boolean(), durationMs: z.number().int().nonnegative().max(11 * 60_000),
  testsPassed: z.boolean(), hiddenTestsPassed: z.boolean(), lineCoverage: z.number().min(0).max(1), branchCoverage: z.number().min(0).max(1),
  functionCoverage: z.number().min(0).max(1), criticalBranchCoverage: z.number().min(0).max(1),
  stdout: z.string().max(50_000), stderr: z.string().max(50_000),
  sandbox: z.object({ network: z.literal("none"), readOnlyRoot: z.literal(true), memoryMb: z.number().int().max(512), cpus: z.number().max(1), pids: z.number().int().max(128), image: z.string().min(1).max(200) }).strict(),
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
  // Optional only for legacy tasks. Do not add a default: the tester signs the
  // exact JSON object and parsing must never mutate that signed object.
  criterionResults: criterionVerificationResultsSchema.optional(),
}).strict();

export const signedEvidenceSubmissionSchema = z.object({
  chainId: z.literal(97),
  taskRegistry: walletAddressSchema,
  taskId: z.string().regex(/^\d+$/),
  workRound: z.number().int().positive(),
  checkpoint: z.number().int().min(0).max(3),
  panelEpoch: z.number().int().positive(),
  verificationShard: z.number().int().min(0).max(2),
  executionMode: z.enum(["COLLABORATION", "COMPETITION"]),
  executorOrder: z.array(walletAddressSchema).min(1).max(32),
  testerAgentId: z.string().min(3).max(120),
  artifactHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  report: testEvidenceReportSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();

export type TestEvidenceReport = z.infer<typeof testEvidenceReportSchema>;
export type SignedEvidenceSubmission = z.infer<typeof signedEvidenceSubmissionSchema>;
