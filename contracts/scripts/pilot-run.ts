import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createWalletClient, decodeEventLog, formatEther, http, keccak256, parseEther, stringToHex,
  type Abi, type Address, type Hash, type TransactionReceipt,
} from "viem";
import { bscTestnet } from "viem/chains";
import { compileContracts } from "./compiler";
import { runPilotPreflight, type PilotPreflightContext, type PilotPreflightReport } from "./pilot-preflight";
import { pilotRoleNames, type PilotRoleName } from "./pilot-policy";

type RecordedTransaction = { hash: Hash; blockNumber?: string; gasUsed?: string; status?: "success" | "reverted" };
interface PilotRunState {
  version: 1;
  runId: string;
  scope: "synthetic-onchain-lifecycle-not-real-business-acceptance";
  startedAt: string;
  completedAt?: string;
  deploymentFile: string;
  deploymentSha256: string;
  roles: Record<PilotRoleName, Address>;
  transactions: Record<string, RecordedTransaction>;
  positions: Partial<Record<Exclude<PilotRoleName, "coordinator">, string>>;
  taskId?: string;
  selectedEvaluators?: Address[];
  selectedTester?: Address;
  hashes: { spec: Hash; artifact: Hash; evaluationEvidence: Hash[]; testEvidence: Hash };
  final?: { taskState: number; grantTotal: string; initialTranche: string; roleTokenBalances: Record<string, string> };
  preflight: PilotPreflightReport;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const artifacts = compileContracts();

function runStatePath() {
  const root = path.resolve("contracts", "pilot-runs");
  fs.mkdirSync(root, { recursive: true });
  const requested = process.env.PILOT_RUN_FILE
    ? path.resolve(process.env.PILOT_RUN_FILE)
    : path.join(root, `bsc-testnet-${new Date().toISOString().replace(/[-:.]/g, "")}.json`);
  if (!requested.startsWith(`${root}${path.sep}`) || path.extname(requested) !== ".json") throw new Error("PILOT_RUN_FILE_OUTSIDE_EVIDENCE_DIRECTORY");
  return requested;
}

function saveState(file: string, state: PilotRunState) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function parseState(file: string) {
  const state = JSON.parse(fs.readFileSync(file, "utf8")) as PilotRunState;
  if (state.version !== 1 || state.scope !== "synthetic-onchain-lifecycle-not-real-business-acceptance" || !state.runId) throw new Error("PILOT_RUN_STATE_INVALID");
  return state;
}

function wallet(context: PilotPreflightContext, role: PilotRoleName) {
  return createWalletClient({ account: context.accounts[role], chain: bscTestnet, transport: http(context.rpcUrl) });
}

async function runTransaction(
  file: string,
  state: PilotRunState,
  context: PilotPreflightContext,
  label: string,
  role: PilotRoleName,
  address: Address,
  contractName: string,
  functionName: string,
  args: readonly unknown[] = [],
) {
  let recorded = state.transactions[label];
  if (!recorded) {
    const hash = await wallet(context, role).writeContract({
      address, abi: artifacts[contractName].abi as Abi, functionName, args,
    } as never);
    recorded = { hash };
    state.transactions[label] = recorded;
    saveState(file, state);
  }
  const receipt = await context.publicClient.waitForTransactionReceipt({ hash: recorded.hash, confirmations: 5 });
  recorded.blockNumber = receipt.blockNumber.toString();
  recorded.gasUsed = receipt.gasUsed.toString();
  recorded.status = receipt.status;
  saveState(file, state);
  if (receipt.status !== "success") throw new Error(`PILOT_TRANSACTION_REVERTED_${label}`);
  return receipt;
}

function decodedEvent(receipt: TransactionReceipt, contractName: string, eventName: string) {
  for (const log of receipt.logs) {
    try { return decodeEventLog({ abi: artifacts[contractName].abi as Abi, eventName, data: log.data, topics: log.topics }); }
    catch { /* Another event in the same transaction. */ }
  }
  throw new Error(`PILOT_EVENT_MISSING_${eventName}`);
}

async function read(context: PilotPreflightContext, address: Address, contractName: string, functionName: string, args: readonly unknown[] = []) {
  return context.publicClient.readContract({ address, abi: artifacts[contractName].abi as Abi, functionName, args } as never);
}

async function waitPastBlock(context: PilotPreflightContext, target: bigint) {
  const deadline = Date.now() + 10 * 60_000;
  while (await context.publicClient.getBlockNumber() <= target) {
    if (Date.now() > deadline) throw new Error("PILOT_SELECTION_BLOCK_TIMEOUT");
    await sleep(3_000);
  }
}

async function prepareStakedAgent(
  file: string, state: PilotRunState, context: PilotPreflightContext,
  role: Exclude<PilotRoleName, "publisher" | "coordinator">, capability: number,
) {
  const { token, stakeManager, agentRegistry } = context.deployment.contracts;
  await runTransaction(file, state, context, `${role}.faucet`, role, token, "TestToken", "faucet");
  await runTransaction(file, state, context, `${role}.approve`, role, token, "TestToken", "approve", [stakeManager, parseEther("1000")]);
  const positionReceipt = await runTransaction(file, state, context, `${role}.position`, role, stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
  const positionId = String((decodedEvent(positionReceipt, "StakeCreditManager", "PositionCreated").args as unknown as { positionId: bigint }).positionId);
  state.positions[role] = positionId;
  saveState(file, state);
  await runTransaction(file, state, context, `${role}.register`, role, agentRegistry, "AgentRegistry", "registerWithCapabilities", [BigInt(positionId), capability]);
}

async function preparePublisher(file: string, state: PilotRunState, context: PilotPreflightContext) {
  const { token, stakeManager } = context.deployment.contracts;
  await runTransaction(file, state, context, "publisher.faucet", "publisher", token, "TestToken", "faucet");
  await runTransaction(file, state, context, "publisher.approve", "publisher", token, "TestToken", "approve", [stakeManager, parseEther("1000")]);
  const receipt = await runTransaction(file, state, context, "publisher.position", "publisher", stakeManager, "StakeCreditManager", "createPosition", [parseEther("1000")]);
  const positionId = String((decodedEvent(receipt, "StakeCreditManager", "PositionCreated").args as unknown as { positionId: bigint }).positionId);
  state.positions.publisher = positionId;
  saveState(file, state);
  await runTransaction(file, state, context, "publisher.credit", "publisher", stakeManager, "StakeCreditManager", "issueCredit", [BigInt(positionId)]);
}

function newState(context: PilotPreflightContext, preflight: PilotPreflightReport): PilotRunState {
  const runId = randomUUID();
  return {
    version: 1, runId, scope: "synthetic-onchain-lifecycle-not-real-business-acceptance", startedAt: new Date().toISOString(),
    deploymentFile: context.deploymentFile, deploymentSha256: preflight.deployment!.sha256,
    roles: Object.fromEntries(pilotRoleNames.map((role) => [role, context.accounts[role].address])) as Record<PilotRoleName, Address>,
    transactions: {}, positions: {}, preflight,
    hashes: {
      spec: keccak256(stringToHex(`agentgrid-bsc-pilot:${runId}:synthetic-task-spec`)),
      artifact: keccak256(stringToHex(`agentgrid-bsc-pilot:${runId}:synthetic-artifact`)),
      evaluationEvidence: [0, 1, 2].map((index) => keccak256(stringToHex(`agentgrid-bsc-pilot:${runId}:evaluation:${index}`))),
      testEvidence: keccak256(stringToHex(`agentgrid-bsc-pilot:${runId}:test-evidence`)),
    },
  };
}

function assertResumeState(state: PilotRunState, context: PilotPreflightContext, preflight: PilotPreflightReport) {
  if (state.deploymentSha256 !== preflight.deployment?.sha256 || path.resolve(state.deploymentFile) !== context.deploymentFile) throw new Error("PILOT_RESUME_DEPLOYMENT_MISMATCH");
  for (const role of pilotRoleNames) if (state.roles[role].toLowerCase() !== context.accounts[role].address.toLowerCase()) throw new Error("PILOT_RESUME_ROLE_MISMATCH");
  if (state.completedAt) throw new Error("PILOT_RUN_ALREADY_COMPLETED");
}

async function execute(file: string, state: PilotRunState, context: PilotPreflightContext) {
  const contracts = context.deployment.contracts;
  await prepareStakedAgent(file, state, context, "evaluator1", 4);
  await prepareStakedAgent(file, state, context, "evaluator2", 4);
  await prepareStakedAgent(file, state, context, "evaluator3", 4);
  await prepareStakedAgent(file, state, context, "executor", 1);
  await prepareStakedAgent(file, state, context, "tester", 2);
  await preparePublisher(file, state, context);

  const createReceipt = await runTransaction(file, state, context, "task.create", "publisher", contracts.taskRegistry, "TaskRegistry", "createTaskWithMode", [
    BigInt(state.positions.publisher!), state.hashes.spec, parseEther("1000"), 1, 0,
  ]);
  const taskId = String((decodedEvent(createReceipt, "TaskRegistry", "TaskEvaluationRequested").args as unknown as { taskId: bigint }).taskId);
  state.taskId = taskId;
  saveState(file, state);

  const evaluationSelection = await read(context, contracts.taskRegistry, "TaskRegistry", "evaluationSelections", [BigInt(taskId)]) as readonly unknown[];
  await waitPastBlock(context, BigInt(String(evaluationSelection[0])));
  await runTransaction(file, state, context, "evaluation.panel", "coordinator", contracts.taskRegistry, "TaskRegistry", "finalizeEvaluationPanel", [BigInt(taskId)]);
  const selectedEvaluators = await read(context, contracts.taskRegistry, "TaskRegistry", "getTaskEvaluators", [BigInt(taskId)]) as Address[];
  const evaluatorRoles = ["evaluator1", "evaluator2", "evaluator3"] as const;
  const evaluatorByAddress = new Map(evaluatorRoles.map((role) => [context.accounts[role].address.toLowerCase(), role]));
  if (selectedEvaluators.some((address) => !evaluatorByAddress.has(address.toLowerCase()))) throw new Error("PILOT_UNCONTROLLED_EVALUATOR_SELECTED");
  state.selectedEvaluators = selectedEvaluators;
  saveState(file, state);
  for (let index = 0; index < selectedEvaluators.length; index += 1) {
    const role = evaluatorByAddress.get(selectedEvaluators[index].toLowerCase())!;
    await runTransaction(file, state, context, `evaluation.report.${role}`, role, contracts.taskRegistry, "TaskRegistry", "submitEvaluation", [
      BigInt(taskId), keccak256(stringToHex("development")), 5_000 + index * 500, 24 + index, 8_000, parseEther(String(900 + index * 50)), true,
      state.hashes.evaluationEvidence[index],
    ]);
  }
  await runTransaction(file, state, context, "evaluation.finalize", "coordinator", contracts.taskRegistry, "TaskRegistry", "finalizeTaskEvaluation", [BigInt(taskId)]);
  await runTransaction(file, state, context, "work.claim", "executor", contracts.taskRegistry, "TaskRegistry", "claimTask", [BigInt(taskId)]);
  await runTransaction(file, state, context, "work.contribution", "executor", contracts.taskRegistry, "TaskRegistry", "submitContribution", [BigInt(taskId), state.hashes.artifact]);
  await runTransaction(file, state, context, "work.submit", "executor", contracts.taskRegistry, "TaskRegistry", "submitWork", [BigInt(taskId), state.hashes.artifact]);
  await runTransaction(file, state, context, "tester.request", "coordinator", contracts.taskRegistry, "TaskRegistry", "requestTester", [BigInt(taskId)]);
  const submittedTask = await read(context, contracts.taskRegistry, "TaskRegistry", "tasks", [BigInt(taskId)]) as readonly unknown[];
  await waitPastBlock(context, BigInt(String(submittedTask[11])));
  await runTransaction(file, state, context, "tester.finalize", "coordinator", contracts.taskRegistry, "TaskRegistry", "finalizeTester", [BigInt(taskId)]);
  const testingTask = await read(context, contracts.taskRegistry, "TaskRegistry", "tasks", [BigInt(taskId)]) as readonly unknown[];
  const selectedTester = String(testingTask[2]) as Address;
  if (selectedTester.toLowerCase() !== context.accounts.tester.address.toLowerCase()) throw new Error("PILOT_UNCONTROLLED_TESTER_SELECTED");
  state.selectedTester = selectedTester;
  saveState(file, state);
  await runTransaction(file, state, context, "test.submit", "tester", contracts.taskRegistry, "TaskRegistry", "submitTest", [BigInt(taskId), true, state.hashes.testEvidence, [10_000]]);
  await runTransaction(file, state, context, "publisher.accept", "publisher", contracts.taskRegistry, "TaskRegistry", "review", [BigInt(taskId), true, `0x${"0".repeat(64)}`]);
  await runTransaction(file, state, context, "reward.initial", "publisher", contracts.rewardVault, "RewardVault", "claim", [BigInt(taskId), 0]);

  const [finalTask, grant, balances] = await Promise.all([
    read(context, contracts.taskRegistry, "TaskRegistry", "tasks", [BigInt(taskId)]) as Promise<readonly unknown[]>,
    read(context, contracts.rewardVault, "RewardVault", "getGrant", [BigInt(taskId)]) as Promise<{ total: bigint; amounts: readonly bigint[] }>,
    Promise.all(pilotRoleNames.map((role) => read(context, contracts.token, "TestToken", "balanceOf", [context.accounts[role].address]) as Promise<bigint>)),
  ]);
  const taskState = Number(finalTask[19]);
  if (taskState !== 8 || grant.total <= 0n || grant.amounts[0] <= 0n) throw new Error("PILOT_FINAL_STATE_INVALID");
  state.final = {
    taskState, grantTotal: grant.total.toString(), initialTranche: grant.amounts[0].toString(),
    roleTokenBalances: Object.fromEntries(pilotRoleNames.map((role, index) => [role, formatEther(balances[index])])),
  };
  state.completedAt = new Date().toISOString();
  saveState(file, state);
}

async function main() {
  if (process.env.PILOT_BROADCAST_ACK !== "I_UNDERSTAND_THIS_BROADCASTS_BSC_TESTNET_TRANSACTIONS") throw new Error("PILOT_BROADCAST_ACK_REQUIRED");
  const file = runStatePath();
  const resume = fs.existsSync(file);
  const { report, context } = await runPilotPreflight({ requirePristine: !resume, silent: true });
  if (!context) {
    console.log(JSON.stringify(report));
    throw new Error("PILOT_PREFLIGHT_FAILED");
  }
  const state = resume ? parseState(file) : newState(context, report);
  if (resume) assertResumeState(state, context, report);
  else saveState(file, state);
  await execute(file, state, context);
  console.log(JSON.stringify({ completed: true, scope: state.scope, runId: state.runId, evidenceFile: file, taskId: state.taskId, transactions: Object.keys(state.transactions).length, final: state.final }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
