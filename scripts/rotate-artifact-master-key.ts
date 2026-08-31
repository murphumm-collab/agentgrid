import { closePostgresForTests, rotateArtifactMasterKeyEnvelopes } from "../src/lib/store-postgres";
import { runtimeConfig } from "../src/lib/env";

async function main() {
  const config = runtimeConfig();
  if (config.PROTOCOL_MODE !== "production") throw new Error("Set PROTOCOL_MODE=production before rotating keys");
  if (!config.ARTIFACT_MASTER_KEY) throw new Error("ARTIFACT_MASTER_KEY_NOT_CONFIGURED");
  if (!config.ARTIFACT_PREVIOUS_MASTER_KEYS) throw new Error("ARTIFACT_PREVIOUS_MASTER_KEYS_REQUIRED_FOR_ROTATION");
  const result = await rotateArtifactMasterKeyEnvelopes();
  console.log(JSON.stringify({ rotated: true, ...result }));
  await closePostgresForTests();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
