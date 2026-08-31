import { promises as fs } from "node:fs";
import path from "node:path";
import { pilotSignoffDraftSchema, pilotSignoffMessage } from "../src/lib/pilot-signoff";

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error("PILOT_SIGNOFF_DRAFT_FILE_REQUIRED");
  const resolved = path.resolve(filename);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size < 1 || stat.size > 512 * 1024) throw new Error("PILOT_SIGNOFF_DRAFT_SIZE_INVALID");
  const draft = pilotSignoffDraftSchema.parse(JSON.parse(await fs.readFile(resolved, "utf8")));
  const messages = draft.attestations.map((attestation) => pilotSignoffMessage({
    pilotId: draft.pilotId,
    deploymentManifestSha256: draft.deploymentManifestSha256,
    taskIds: draft.taskIds,
    attestation,
  }));
  console.log(JSON.stringify({ version: draft.version, chainId: draft.chainId, pilotId: draft.pilotId, deploymentManifestSha256: draft.deploymentManifestSha256, taskIds: draft.taskIds, messages }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : "PILOT_SIGNOFF_MESSAGES_FAILED");
  process.exitCode = 1;
});
