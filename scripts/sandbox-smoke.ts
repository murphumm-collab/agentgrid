import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runSandboxArchive } from "../src/lib/sandbox";

const exec = promisify(execFile);
async function main() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "agentgrid-sandbox-fixture-"));
  const project = path.join(root, "project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test" } }));
  await fs.mkdir(path.join(project, "src"));
  await fs.writeFile(path.join(project, "src", "math.mjs"), "export function add(a,b){return a+b}\n");
  await fs.mkdir(path.join(project, "test"));
  await fs.writeFile(path.join(project, "test", "math.test.mjs"), "import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../src/math.mjs';test('add',()=>assert.equal(add(2,3),5));\n");
  const archive = path.join(root, "artifact.tar.gz");
  await exec("tar", ["-czf", archive, "-C", project, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const hidden = path.join(root, "hidden");
  await fs.mkdir(hidden);
  await fs.writeFile(path.join(hidden, "publisher.test.mjs"), "import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../../src/math.mjs';test('publisher acceptance',()=>assert.equal(add(40,2),42));\n");
  const hiddenArchive = path.join(root, "hidden-tests.tar.gz");
  await exec("tar", ["-czf", hiddenArchive, "-C", hidden, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const report = await runSandboxArchive(await fs.readFile(archive), await fs.readFile(hiddenArchive));
  await fs.writeFile(path.join(project, "src", "untested.mjs"), "setInterval(()=>{},1000);export function hidden(v){if(v>10)return 'high';if(v<0)return 'low';return 'mid'}\n");
  await fs.mkdir(path.join(project, "coverage"));
  await fs.writeFile(path.join(project, "coverage", "coverage-summary.json"), JSON.stringify({ total: { lines: { pct: 100 }, branches: { pct: 100 } } }));
  const forgedArchive = path.join(root, "forged-artifact.tar.gz");
  await exec("tar", ["-czf", forgedArchive, "-C", project, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const forgedReport = await runSandboxArchive(await fs.readFile(forgedArchive));
  const malicious = path.join(root, "malicious");
  await fs.mkdir(malicious);
  await fs.symlink("/tmp/work/src", path.join(malicious, "escape"));
  const maliciousArchive = path.join(root, "malicious-hidden-tests.tar.gz");
  await exec("tar", ["-czf", maliciousArchive, "-C", malicious, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  let linkedArchiveRejected = false;
  try { await runSandboxArchive(await fs.readFile(archive), await fs.readFile(maliciousArchive)); }
  catch (error) { linkedArchiveRejected = (error as Error).message === "HIDDEN_TEST_ARCHIVE_UNSAFE"; }
  await fs.rm(root, { recursive: true, force: true });
  if (!report.passed || !report.hiddenTestsPassed || report.sandbox.network !== "none" || !report.sandbox.readOnlyRoot) throw new Error(`SANDBOX_SMOKE_FAILED_${JSON.stringify(report)}`);
  if (forgedReport.passed) throw new Error(`FORGED_COVERAGE_WAS_ACCEPTED_${JSON.stringify(forgedReport)}`);
  if (!linkedArchiveRejected) throw new Error("LINKED_HIDDEN_TEST_ARCHIVE_WAS_ACCEPTED");
  console.log(JSON.stringify({ passed: report.passed, hiddenTestsPassed: report.hiddenTestsPassed, lineCoverage: report.lineCoverage, branchCoverage: report.branchCoverage, functionCoverage: report.functionCoverage, forgedCoverageRejected: true, linkedArchiveRejected, sandbox: report.sandbox }));
}
void main();
