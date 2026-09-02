import fs from "node:fs";
import path from "node:path";
import { compileContracts, solidityCompilerVersion } from "./compiler";
import { runtimeBytecodeHash } from "./bytecode-verification";

const artifactNames = {
  token: "TestToken",
  stakeManager: "StakeCreditManager",
  agentRegistry: "AgentRegistry",
  rewardVault: "RewardVault",
  taskRegistry: "TaskRegistry",
  competitionSlotPassRegistry: "CompetitionSlotPassRegistry",
  verificationPanel: "VerificationPanel",
  verificationArbitrationCourt: "VerificationArbitrationCourt",
  disputeResolver: "DisputeResolver",
  protocolEconomics: "ProtocolEconomics",
} as const;

const artifacts = compileContracts();
const contracts = Object.fromEntries(Object.entries(artifactNames).map(([key, name]) => {
  const artifact = artifacts[name];
  if (!artifact) throw new Error(`MISSING_RUNTIME_ARTIFACT_${name.toUpperCase()}`);
  return [key, {
    name,
    normalizedRuntimeBytecodeHash: runtimeBytecodeHash(artifact),
    immutableReferences: artifact.immutableReferences,
  }];
}));

const output = path.resolve(process.cwd(), "src/generated/runtime-contract-manifest.json");
fs.writeFileSync(output, `${JSON.stringify({ version: 1, compiler: solidityCompilerVersion(), contracts }, null, 2)}\n`);
console.log(`Generated runtime manifest for ${Object.keys(contracts).length} contracts.`);
