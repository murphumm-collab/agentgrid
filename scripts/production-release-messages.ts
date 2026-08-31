import { promises as fs } from "node:fs";
import path from "node:path";
import {
  productionReleaseDraftSchema, productionReleaseManifestSchema, productionReleaseMessage,
} from "../src/lib/production-release-evidence";

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error("PRODUCTION_RELEASE_DRAFT_FILE_REQUIRED");
  const resolved = path.resolve(filename);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) throw new Error("PRODUCTION_RELEASE_DRAFT_SIZE_INVALID");
  const draft = productionReleaseDraftSchema.parse(JSON.parse(await fs.readFile(resolved, "utf8")));
  const { attestations, ...manifestInput } = draft;
  const manifest = productionReleaseManifestSchema.parse(manifestInput);
  const messages = attestations.map((attestation) => productionReleaseMessage({ manifest, attestation }));
  console.log(JSON.stringify({ releaseId: manifest.releaseId, messages }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : "PRODUCTION_RELEASE_MESSAGES_FAILED");
  process.exitCode = 1;
});
