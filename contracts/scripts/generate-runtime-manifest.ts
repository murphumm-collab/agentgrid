import fs from "node:fs";
import path from "node:path";
import { compileContracts, solidityCompilerVersion } from "./compiler";
import { runtimeBytecodeHash } from "./bytecode-verification";

const contractNames = {
  token: "TestToken",
  stakeManager: "StakeCreditManager",
  agentRegistry: "AgentRegistry",
  rewardVault: "RewardVault",
  taskRegistry: "TaskRegistry",
  disputeResolver: "DisputeResolver",
} as const;

const artifacts = compileContracts();
const contracts = Object.fromEntries(Object.entries(contractNames).map(([key, name]) => {
  const artifact = artifacts[name];
  if (!artifact) throw new Error(`RUNTIME_MANIFEST_ARTIFACT_MISSING:${name}`);
  return [key, {
    name,
    normalizedRuntimeBytecodeHash: runtimeBytecodeHash(artifact),
    immutableReferences: artifact.immutableReferences,
  }];
}));

const filename = path.resolve("src/generated/runtime-contract-manifest.json");
fs.writeFileSync(filename, `${JSON.stringify({ version: 1, compiler: solidityCompilerVersion(), contracts }, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ generated: filename, contracts: Object.keys(contracts).length }));
