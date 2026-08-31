import { createHash } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { businessAdoptionReportSchema, verifyBusinessAdoptionSignature } from "./business-adoption";
import { isProductionMode } from "./env";
import { assessPilotQualification, type ValidPilotAdoption } from "./pilot-qualification";
import { verifyPilotSignoffBundle, type VerifiedPilotSignoffBundle } from "./pilot-signoff";
import { protocolSnapshot } from "./service";
import { latestBusinessAdoptions, readChainProjectionRows } from "./store-postgres";

export async function readPilotEvidenceFile(filename: string, maxBytes: number, ownerOnly = false) {
  const handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error("PILOT_EVIDENCE_FILE_SIZE_INVALID");
    if (ownerOnly && (stat.mode & 0o077) !== 0) throw new Error("PILOT_SIGNOFF_FILE_PERMISSIONS_INVALID");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function sameTime(left: string, right: string) {
  return new Date(left).getTime() === new Date(right).getTime();
}

export async function pilotQualificationReport() {
  const production = isProductionMode();
  const [snapshot, rows, adoptionRows] = production
    ? await Promise.all([protocolSnapshot(), readChainProjectionRows(), latestBusinessAdoptions()])
    : [await protocolSnapshot(), { events: [], commitments: [] }, []];
  const validAdoptions: ValidPilotAdoption[] = [];
  let invalidAdoptionRows = 0;
  for (const row of adoptionRows) {
    try {
      const report = businessAdoptionReportSchema.parse(row.report);
      const verified = await verifyBusinessAdoptionSignature({ report, signature: row.signature as `0x${string}`, expectedAddress: row.publisher });
      if (verified.reportHash.toLowerCase() !== row.reportHash.toLowerCase()
        || report.taskId !== row.taskId
        || report.publisher.toLowerCase() !== row.publisher.toLowerCase()
        || report.artifactHash !== row.artifactHash
        || report.workflowType !== row.workflowType
        || report.workflowEvidenceHash !== row.workflowEvidenceHash
        || !sameTime(report.adoptedAt, row.adoptedAt)) throw new Error("PILOT_ADOPTION_ROW_MISMATCH");
      validAdoptions.push({ taskId: row.taskId, publisher: row.publisher, artifactHash: row.artifactHash, reportHash: row.reportHash });
    } catch { invalidAdoptionRows += 1; }
  }

  const deploymentFile = path.resolve(process.env.PILOT_DEPLOYMENT_FILE ?? path.join(process.cwd(), "contracts", "deployments", "bsc-testnet.json"));
  let deploymentManifestSha256: string | undefined;
  try {
    const deploymentBytes = await readPilotEvidenceFile(deploymentFile, 1024 * 1024);
    deploymentManifestSha256 = `sha256:${createHash("sha256").update(deploymentBytes).digest("hex")}`;
  } catch { /* Reported as an explicit blocker below. */ }

  const signoffFile = process.env.PILOT_SIGNOFF_FILE ? path.resolve(process.env.PILOT_SIGNOFF_FILE) : undefined;
  let signoff: VerifiedPilotSignoffBundle | undefined;
  let signoffSha256: string | undefined;
  let signoffStatus: "missing" | "invalid" | "verified" = "missing";
  if (signoffFile) {
    try {
      const bytes = await readPilotEvidenceFile(signoffFile, 512 * 1024, true);
      signoff = await verifyPilotSignoffBundle(JSON.parse(bytes.toString("utf8")));
      signoffSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      signoffStatus = "verified";
    } catch { signoffStatus = "invalid"; }
  }

  const report = assessPilotQualification({
    tasks: snapshot.tasks,
    events: rows.events.filter((event) => Boolean(event.eventName)).map((event) => ({
      eventName: event.eventName!,
      eventArgs: event.eventArgs as Record<string, unknown> | undefined,
    })),
    validAdoptions,
    invalidAdoptionRows,
    signoff,
    signoffStatus,
    deploymentManifestSha256,
  });
  if (!production) report.blockers.unshift("PILOT_PRODUCTION_MODE_REQUIRED");
  if (!deploymentManifestSha256) report.blockers.unshift("BSC_TESTNET_DEPLOYMENT_FILE_MISSING");
  report.technicalEvidenceReady = report.technicalEvidenceReady && production && Boolean(deploymentManifestSha256);
  report.launchEvidenceReady = report.launchEvidenceReady && report.technicalEvidenceReady;
  return {
    checkedAt: new Date().toISOString(),
    ...report,
    files: {
      deployment: deploymentManifestSha256 ? { path: deploymentFile, sha256: deploymentManifestSha256 } : null,
      signoff: signoffStatus === "verified" && signoffFile && signoffSha256 ? { path: signoffFile, sha256: signoffSha256 } : null,
    },
  };
}
