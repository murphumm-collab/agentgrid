import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deploymentConfigurationSha256, deploymentRunStatePath, newDeploymentRunState,
  readDeploymentRunState, saveDeploymentRunState,
} from "./deployment-run-state";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "agentgrid-deployment-state-"));
  directories.push(root);
  fs.mkdirSync(path.join(root, "contracts", "deployments"), { recursive: true });
  return root;
}

describe("resumable deployment evidence", () => {
  it("binds the exact deployment configuration", () => {
    const base = { chainId: 97, owner: "0x1000000000000000000000000000000000000001", quorum: 2 };
    expect(deploymentConfigurationSha256(base)).toBe(deploymentConfigurationSha256({ ...base }));
    expect(deploymentConfigurationSha256(base)).not.toBe(deploymentConfigurationSha256({ ...base, quorum: 3 }));
  });

  it("writes an owner-only state and restores transaction hashes", async () => {
    const root = await workspace();
    const filename = deploymentRunStatePath(root);
    const state = newDeploymentRunState(`sha256:${"a".repeat(64)}`);
    state.transactions["deploy.token"] = { hash: `0x${"1".repeat(64)}` };
    saveDeploymentRunState(filename, state);
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    expect(readDeploymentRunState(filename)).toEqual(state);
  });

  it("rejects paths outside the evidence directory, permissive files and symlinks", async () => {
    const root = await workspace();
    expect(() => deploymentRunStatePath(root, path.join(root, "outside.pending.json"))).toThrow("DEPLOYMENT_RUN_FILE_OUTSIDE_EVIDENCE_DIRECTORY");
    const filename = deploymentRunStatePath(root);
    saveDeploymentRunState(filename, newDeploymentRunState(`sha256:${"b".repeat(64)}`));
    fs.chmodSync(filename, 0o644);
    expect(() => readDeploymentRunState(filename)).toThrow("DEPLOYMENT_RUN_STATE_PERMISSIONS_INVALID");
    fs.chmodSync(filename, 0o600);
    const link = path.join(root, "contracts", "deployments", "link.pending.json");
    fs.symlinkSync(filename, link);
    expect(() => readDeploymentRunState(link)).toThrow();
  });
});
