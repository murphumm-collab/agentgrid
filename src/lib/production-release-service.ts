import { protocolLaunchBlockers } from "./protocol-launch-gates";
import { createHash } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { getAddress } from "viem";
import { z } from "zod";
import { applicationQaBindingBlockers, verifyApplicationQaReport } from "./application-qa-evidence";
import {
  backupEvidenceBindingBlockers, verifyBackupRestoreReport, verifyOffsiteBackupReport,
} from "./backup-evidence";
import { candidateReleaseManifestSchema } from "./candidate-release";
import { edgeSecurityBindingBlockers, verifyEdgeSecurityReport } from "./edge-security-evidence";
import { kmsCustodyBindingBlockers, verifyKmsCustodyReport } from "./kms-custody-evidence";
import { monitoringEvidenceBindingBlockers, verifyMonitoringAlertDrillReport } from "./monitoring-evidence";
import { pilotQualificationReport, readPilotEvidenceFile } from "./pilot-qualification-service";
import { verifyPilotSignoffBundle } from "./pilot-signoff";
import {
  verifyProductionReleaseBundle, type ProductionReleaseManifest,
} from "./production-release-evidence";

const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const transactionSchema = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  blockNumber: z.string().regex(/^\d+$/),
  gasUsed: z.string().regex(/^\d+$/),
  status: z.literal("success"),
}).passthrough();
const deploymentSchema = z.object({
  chainId: z.literal(97),
  owner: addressSchema,
  startBlock: z.string().regex(/^\d+$/),
  confirmations: z.literal(5),
  contracts: z.object({
    token: addressSchema, stakeManager: addressSchema, agentRegistry: addressSchema,
    rewardVault: addressSchema, taskRegistry: addressSchema, disputeResolver: addressSchema,
  }).strict(),
  transactions: z.record(z.string(), transactionSchema),
}).passthrough();

const requiredDeploymentTransactions = [
  "deploy.token", "deploy.stakeManager", "deploy.agentRegistry", "deploy.rewardVault", "deploy.taskRegistry", "deploy.disputeResolver",
  "wire.stakeManager", "wire.stakeAgentRegistry", "wire.agentRegistry", "wire.disputeResolver", "wire.rewardVault", "fund.rewardReserve",
  "ownership.TestToken", "ownership.StakeCreditManager", "ownership.RewardVault", "ownership.TaskRegistry", "ownership.DisputeResolver",
] as const;

export async function readReleaseEvidenceFile(root: string, relative: string, maxBytes = 32 * 1024 * 1024) {
  const resolvedRoot = path.resolve(root);
  const filename = path.resolve(resolvedRoot, relative);
  if (!filename.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("PRODUCTION_RELEASE_EVIDENCE_PATH_OUTSIDE_ROOT");
  const handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error("PRODUCTION_RELEASE_EVIDENCE_FILE_SIZE_INVALID");
    if ((stat.mode & 0o022) !== 0) throw new Error("PRODUCTION_RELEASE_EVIDENCE_FILE_WRITABLE_BY_OTHERS");
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function verifyFiles(root: string, manifest: ProductionReleaseManifest) {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("PRODUCTION_RELEASE_EVIDENCE_ROOT_INVALID");
  const result = new Map<string, Buffer>();
  for (const [name, reference] of Object.entries(manifest.files)) {
    const bytes = await readReleaseEvidenceFile(root, reference.file);
    if (sha256(bytes).toLowerCase() !== reference.sha256.toLowerCase()) throw new Error(`PRODUCTION_RELEASE_${name.toUpperCase()}_HASH_MISMATCH`);
    result.set(name, bytes);
  }
  return result;
}

export async function productionReleaseReadinessReport() {
  const pilot = await pilotQualificationReport();
  // These are properties of this protocol revision, not operator attestations.
  // Remove only with a reviewed protocol fix and adversarial regression evidence.
  const blockers = [...protocolLaunchBlockers, ...pilot.blockers];
  if (!pilot.launchEvidenceReady) blockers.unshift("PILOT_QUALIFICATION_NOT_READY");
  const bundleFile = process.env.PRODUCTION_RELEASE_EVIDENCE_FILE ? path.resolve(process.env.PRODUCTION_RELEASE_EVIDENCE_FILE) : undefined;
  const evidenceRoot = process.env.PRODUCTION_RELEASE_EVIDENCE_ROOT ? path.resolve(process.env.PRODUCTION_RELEASE_EVIDENCE_ROOT) : undefined;
  if (!bundleFile) blockers.unshift("PRODUCTION_RELEASE_EVIDENCE_FILE_MISSING");
  if (!evidenceRoot) blockers.unshift("PRODUCTION_RELEASE_EVIDENCE_ROOT_MISSING");

  let release: Awaited<ReturnType<typeof verifyProductionReleaseBundle>> | undefined;
  let evidenceFiles: Map<string, Buffer> | undefined;
  if (bundleFile && evidenceRoot) {
    try {
      const bundleBytes = await readPilotEvidenceFile(bundleFile, 1024 * 1024, true);
      release = await verifyProductionReleaseBundle(JSON.parse(bundleBytes.toString("utf8")));
      evidenceFiles = await verifyFiles(evidenceRoot, release.manifest);
    } catch { blockers.unshift("PRODUCTION_RELEASE_EVIDENCE_INVALID"); }
  }

  let deploymentOwner: string | undefined;
  let candidateBuildId: string | undefined;
  let applicationQaCommands = 0;
  let verifiedBackupRestores = 0;
  let verifiedMonitoringEvents = 0;
  let verifiedEdgeControlGroups = 0;
  let verifiedCustodyAssets = 0;
  if (release && evidenceFiles) {
    try {
      const candidateBytes = evidenceFiles.get("candidateReleaseManifest")!;
      const candidate = candidateReleaseManifestSchema.parse(JSON.parse(candidateBytes.toString("utf8")));
      const deploymentBytes = evidenceFiles.get("deploymentManifest")!;
      const deployment = deploymentSchema.parse(JSON.parse(deploymentBytes.toString("utf8")));
      const pilotSignoff = await verifyPilotSignoffBundle(JSON.parse(evidenceFiles.get("pilotSignoffBundle")!.toString("utf8")));
      candidateBuildId = candidate.buildId;
      deploymentOwner = getAddress(deployment.owner);
      if (candidate.buildId !== release.manifest.candidateBuildId) blockers.push("PRODUCTION_RELEASE_CANDIDATE_BUILD_MISMATCH");
      if (new Date(candidate.createdAt).getTime() > new Date(release.manifest.createdAt).getTime()) blockers.push("PRODUCTION_RELEASE_PREDATES_CANDIDATE");
      if (requiredDeploymentTransactions.some((label) => !deployment.transactions[label])) blockers.push("PRODUCTION_RELEASE_DEPLOYMENT_TRANSACTIONS_INCOMPLETE");
      if (pilot.files.deployment?.sha256.toLowerCase() !== release.manifest.files.deploymentManifest.sha256.toLowerCase()) blockers.push("PRODUCTION_RELEASE_PILOT_DEPLOYMENT_MISMATCH");
      if (pilot.files.signoff?.sha256.toLowerCase() !== release.manifest.files.pilotSignoffBundle.sha256.toLowerCase()) blockers.push("PRODUCTION_RELEASE_PILOT_SIGNOFF_MISMATCH");
      if (pilot.evidence.pilotId !== pilotSignoff.pilotId || pilot.evidence.taskSetHash?.toLowerCase() !== pilotSignoff.taskSetHash.toLowerCase()) blockers.push("PRODUCTION_RELEASE_PILOT_SCOPE_MISMATCH");
      const ownerSigner = release.attestations.find((attestation) => attestation.role === "PROTOCOL_OWNER")?.signer;
      if (!ownerSigner || ownerSigner.toLowerCase() !== deploymentOwner.toLowerCase()) blockers.push("PRODUCTION_RELEASE_OWNER_SIGNATURE_MISMATCH");
      try {
        const applicationQa = verifyApplicationQaReport(JSON.parse(evidenceFiles.get("applicationQaReport")!.toString("utf8")));
        applicationQaCommands = applicationQa.commands.length;
        blockers.push(...applicationQaBindingBlockers({
          report: applicationQa,
          candidate,
          candidateReleaseManifestSha256: sha256(candidateBytes),
          releaseCreatedAt: release.manifest.createdAt,
        }));
      } catch { blockers.push("PRODUCTION_RELEASE_APPLICATION_QA_INVALID"); }
      try {
        const localBackup = verifyBackupRestoreReport(JSON.parse(evidenceFiles.get("backupRestoreReport")!.toString("utf8")));
        const offsiteBackup = verifyOffsiteBackupReport(JSON.parse(evidenceFiles.get("offsiteBackupReport")!.toString("utf8")));
        verifiedBackupRestores = 2;
        blockers.push(...backupEvidenceBindingBlockers({
          local: localBackup,
          offsite: offsiteBackup,
          candidateBuildId: candidate.buildId,
          deploymentManifestSha256: sha256(deploymentBytes),
          releaseCreatedAt: release.manifest.createdAt,
        }));
      } catch { blockers.push("PRODUCTION_RELEASE_BACKUP_EVIDENCE_INVALID"); }
      try {
        const monitoring = verifyMonitoringAlertDrillReport(JSON.parse(evidenceFiles.get("monitoringAlertDrillReport")!.toString("utf8")));
        verifiedMonitoringEvents = monitoring.events.length;
        blockers.push(...monitoringEvidenceBindingBlockers({
          report: monitoring,
          candidateBuildId: candidate.buildId,
          candidateCreatedAt: candidate.createdAt,
          deploymentManifestSha256: sha256(deploymentBytes),
          releaseCreatedAt: release.manifest.createdAt,
        }));
      } catch { blockers.push("PRODUCTION_RELEASE_MONITORING_EVIDENCE_INVALID"); }
      try {
        const edge = verifyEdgeSecurityReport(JSON.parse(evidenceFiles.get("tlsWafTrustedProxyReport")!.toString("utf8")));
        verifiedEdgeControlGroups = 4;
        blockers.push(...edgeSecurityBindingBlockers({
          report: edge,
          candidateBuildId: candidate.buildId,
          candidateCreatedAt: candidate.createdAt,
          deploymentManifestSha256: sha256(deploymentBytes),
          releaseCreatedAt: release.manifest.createdAt,
        }));
      } catch { blockers.push("PRODUCTION_RELEASE_EDGE_EVIDENCE_INVALID"); }
      try {
        const custody = verifyKmsCustodyReport(JSON.parse(evidenceFiles.get("kmsCustodyRecoveryReport")!.toString("utf8")));
        verifiedCustodyAssets = custody.assets.length;
        blockers.push(...kmsCustodyBindingBlockers({
          report: custody,
          candidateBuildId: candidate.buildId,
          candidateCreatedAt: candidate.createdAt,
          deploymentManifestSha256: sha256(deploymentBytes),
          releaseCreatedAt: release.manifest.createdAt,
        }));
      } catch { blockers.push("PRODUCTION_RELEASE_KMS_EVIDENCE_INVALID"); }
    } catch { blockers.push("PRODUCTION_RELEASE_BOUND_EVIDENCE_INVALID"); }
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    checkedAt: new Date().toISOString(),
    productionReleaseReady: uniqueBlockers.length === 0,
    releaseId: release?.manifest.releaseId ?? null,
    releaseManifestHash: release?.manifestHash ?? null,
    candidateBuildId: candidateBuildId ?? null,
    deploymentOwner: deploymentOwner ?? null,
    applicationQaCommands,
    verifiedBackupRestores,
    verifiedMonitoringEvents,
    verifiedEdgeControlGroups,
    verifiedCustodyAssets,
    verifiedReleaseSignatures: release?.attestations.length ?? 0,
    pilot,
    blockers: uniqueBlockers,
    limitations: [
      "SIGNED_FILE_HASHES_PROVE_INTEGRITY_AND_APPROVAL_NOT_THE_TRUTH_OF_EXTERNAL_REPORTS",
      "CONTAINER_IMAGE_DIGESTS_REQUIRE_INDEPENDENT_REGISTRY_PROVENANCE_VERIFICATION",
    ],
  };
}
