import { build } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";

const outdir = path.resolve("dist-workers");
async function main() {
  await fs.rm(outdir, { recursive: true, force: true });
  await build({
    entryPoints: {
      migrate: "scripts/migrate.ts",
      indexer: "scripts/index-chain-worker.ts",
      coordinator: "scripts/coordinator-worker.ts",
      maintenance: "scripts/maintenance-scheduler.ts",
      teamFormation: "scripts/team-formation-scheduler.ts",
      evaluationExpiry: "scripts/evaluation-expiry-scheduler.ts",
      simpleAiRunner: "agents/simple-ai-runner.ts",
      ciTester: "agents/ci-tester-worker.ts",
      taskEvaluator: "agents/task-evaluator-worker.ts",
      backup: "scripts/backup-worker.ts",
      monitor: "scripts/operational-monitor-worker.ts",
      monitorDrill: "scripts/monitoring-alert-drill-once.ts",
      edgeVerify: "scripts/edge-security-verify.ts",
      kmsVerify: "scripts/kms-custody-verify.ts",
      rotateArtifactKey: "scripts/rotate-artifact-master-key.ts",
    },
    outdir,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    minify: true,
    sourcemap: false,
    external: ["pg-native"],
    logLevel: "info",
  });
}
void main();
