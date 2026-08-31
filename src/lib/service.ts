import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { createPublicClient, defineChain, formatEther, getAddress, http, keccak256, stringToHex } from "viem";
import {
  addDays,
  collaborationKey,
  consumeTaskCredit,
  issueTaskCredit,
  protocolHash,
  releaseTaskSlot,
  selectRandomTester,
  validateAndCreateReward,
  validateSoftwareEvidence,
} from "./protocol";
import { readDatabase, updateDatabase } from "./store";
import type { Agent, AgentRole, AgentScope, SoftwareEvidence, Task } from "./types";
import { chainContractAddresses, isProductionMode, runtimeConfig } from "./env";
import { latestBusinessAdoptions, latestSignedTaskEvaluations, latestSignedTestEvidence, readChainProjectionRows } from "./store-postgres";
import { projectChainBusiness } from "./chain-projection";
import { agentRegistryAbi, stakeManagerAbi } from "./contracts";
import { AGENT_ROLES, AGENT_ROLE_CAPABILITY_MASK, AGENT_ROLE_DEFAULT_SCOPES, AGENT_SCOPES, roleAllowsScope } from "./agent-roles";
import { assessTaskDefinition, taskDefinitionSchema } from "./task-definition";

const scrypt = promisify(scryptCallback);
const bscTestnet = defineChain({
  id: 97,
  name: "BSC Testnet",
  nativeCurrency: { name: "Test BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-testnet-dataseed.bnbchain.org"] } },
});

export const actorSchema = z.string().min(3).max(120);

export const createTaskSchema = z.object({
  publisher: actorSchema,
  stakePositionId: z.string().min(3),
  title: z.string().min(8).max(120),
  description: z.string().min(30).max(4_000),
  category: z.string().min(2).max(40),
  maxExecutors: z.number().int().min(1).max(32),
  declaredDurationHours: z.number().min(0.25).max(720),
  criteria: z.array(z.string().min(8).max(240)).min(1).max(12),
  completionDefinition: taskDefinitionSchema,
}).superRefine((spec, context) => {
  if (spec.criteria.length !== spec.completionDefinition.acceptanceCriteria.length || spec.criteria.some((criterion, index) => criterion !== spec.completionDefinition.acceptanceCriteria[index]?.description)) {
    context.addIssue({ code: "custom", path: ["criteria"], message: "CRITERIA_DEFINITION_MISMATCH" });
  }
  if (!assessTaskDefinition(spec.completionDefinition).ready) context.addIssue({ code: "custom", path: ["completionDefinition"], message: "COMPLETION_DEFINITION_NOT_READY" });
});

export const registerAgentSchema = z.object({
  name: z.string().min(3).max(80),
  owner: actorSchema,
  role: z.enum(AGENT_ROLES),
  capabilities: z.array(z.string().min(2).max(40)).min(1).max(20),
  endpoint: z.string().url(),
  stake: z.number().min(0).default(0),
  stakePositionId: z.string().regex(/^\d+$/).optional(),
  scopes: z.array(z.enum(AGENT_SCOPES)).optional(),
});

export const softwareEvidenceSchema = z.object({
  testsPassed: z.boolean(),
  hiddenTestsPassed: z.boolean(),
  lineCoverage: z.number().min(0).max(1),
  branchCoverage: z.number().min(0).max(1),
  criticalBranchCoverage: z.number().min(0).max(1),
  artifactHash: z.string().startsWith("sha256:"),
  logUrl: z.string().url().optional(),
});

export async function protocolSnapshot() {
  const database = await readDatabase();
  if (isProductionMode()) {
    const rows = await readChainProjectionRows();
    const projection = projectChainBusiness(rows);
    database.positions = projection.positions;
    database.tasks = projection.tasks;
    database.rewards = projection.rewards;
    const submittedEvaluations = new Map(rows.events.filter((event) => event.eventName === "TaskEvaluationSubmitted").map((event) => [
      `${String(event.eventArgs?.taskId)}:${String(event.eventArgs?.evaluator).toLowerCase()}`,
      String(event.eventArgs?.reportHash).toLowerCase(),
    ]));
    const finalizedCategories = new Map(rows.events.filter((event) => event.eventName === "TaskEvaluationFinalized" && event.eventArgs?.approved).map((event) => [String(event.eventArgs?.taskId), String(event.eventArgs?.categoryHash).toLowerCase()]));
    for (const evaluation of await latestSignedTaskEvaluations()) {
      if (submittedEvaluations.get(`${evaluation.taskId}:${evaluation.evaluatorAddress.toLowerCase()}`) !== evaluation.reportHash.toLowerCase()) continue;
      const category = String(evaluation.report.category ?? "");
      if (!category || keccak256(stringToHex(category)).toLowerCase() !== finalizedCategories.get(evaluation.taskId)) continue;
      const task = database.tasks.find((item) => item.id === evaluation.taskId);
      if (task) { task.category = category; if (task.evaluation) task.evaluation.category = category; }
    }
    const submittedEvidence = new Map(rows.events.filter((event) => event.eventName === "TestSubmitted" || event.eventName === "CompetitionResultSubmitted").map((event) => [String(event.eventArgs?.taskId), String(event.eventArgs?.evidenceHash).toLowerCase()]));
    for (const evidence of await latestSignedTestEvidence()) {
      const evidenceHash = keccak256(stringToHex(JSON.stringify({ reportHash: evidence.reportHash, signer: evidence.testerAddress.toLowerCase(), signature: evidence.signature.toLowerCase() })));
      if (submittedEvidence.get(evidence.taskId) !== evidenceHash.toLowerCase()) continue;
      const task = database.tasks.find((item) => item.id === evidence.taskId);
      const report = evidence.report as Record<string, unknown>;
      if (!task) continue;
      task.testResult = {
        testerId: evidence.testerAddress, passed: Boolean(report.passed), failures: report.passed ? [] : ["Independent verification failed"],
        testsPassed: Boolean(report.testsPassed), hiddenTestsPassed: Boolean(report.hiddenTestsPassed), artifactHash: evidence.artifactHash,
        lineCoverage: Number(report.lineCoverage), branchCoverage: Number(report.branchCoverage), criticalBranchCoverage: Number(report.criticalBranchCoverage),
        submittedAt: evidence.createdAt, selectionProof: task.testerSelectionProof ?? "", reportHash: evidence.reportHash,
        executorWeightsBps: Array.isArray(report.executorWeightsBps) ? report.executorWeightsBps.map(Number) : undefined,
        contributionWork: Array.isArray(report.contributionWork) ? report.contributionWork as NonNullable<typeof task.testResult>["contributionWork"] : undefined,
        competition: report.competition && typeof report.competition === "object" ? report.competition as NonNullable<typeof task.testResult>["competition"] : undefined,
      };
    }
    for (const adoption of await latestBusinessAdoptions()) {
      const task = database.tasks.find((item) => item.id === adoption.taskId);
      if (!task || !task.submission || !["MAINTENANCE", "COMPLETED"].includes(task.state)
        || task.publisher.toLowerCase() !== adoption.publisher.toLowerCase()
        || keccak256(stringToHex(adoption.artifactHash)).toLowerCase() !== task.submission.artifactHash.toLowerCase()) continue;
      task.businessAdoption = {
        publisher: adoption.publisher,
        artifactHash: adoption.artifactHash,
        workflowType: adoption.workflowType,
        workflowEvidenceHash: adoption.workflowEvidenceHash,
        adoptedAt: adoption.adoptedAt,
        reportHash: adoption.reportHash,
        attestedAt: adoption.createdAt,
      };
    }
  }
  const lockedStake = database.positions.reduce((sum, position) => sum + position.amount, 0);
  const activeTasks = database.tasks.filter((task) => !["COMPLETED", "REJECTED"].includes(task.state)).length;
  const completedTasks = database.tasks.filter((task) => task.state === "COMPLETED").length;
  const publicAgents = database.agents.map((agent) => {
    const publicAgent: Partial<Agent> = { ...agent };
    if (isProductionMode()) {
      const position = database.positions.find((item) => item.id === agent.stakePositionId && item.owner.toLowerCase() === agent.owner.toLowerCase());
      publicAgent.stake = position?.amount ?? 0;
      publicAgent.online = Boolean(agent.online && position && position.amount >= database.config.minAgentStake);
    }
    delete publicAgent.apiKey;
    delete publicAgent.apiKeyHash;
    delete publicAgent.apiKeySalt;
    return publicAgent as Omit<Agent, "apiKey" | "apiKeyHash" | "apiKeySalt">;
  });
  const onlineAgents = publicAgents.filter((agent) => agent.online).length;
  return {
    config: database.config,
    stats: {
      lockedStake,
      activeTasks,
      completedTasks,
      onlineAgents,
      rewardReserve: database.config.epochRewardBudget - database.config.epochRewardIssued,
      issuedRewards: database.config.epochRewardIssued,
    },
    positions: database.positions,
    tasks: database.tasks,
    agents: publicAgents,
    rewards: database.rewards,
    ledger: database.ledger,
  };
}

export async function faucet(owner: string, amount = 10_000) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 50_000) throw new Error("INVALID_FAUCET_AMOUNT");
  return updateDatabase((database) => {
    const previousFaucet = database.ledger
      .filter((entry) => entry.owner === owner && entry.type === "FAUCET")
      .reduce((sum, entry) => sum + entry.amount, 0);
    if (previousFaucet + amount > 50_000) throw new Error("FAUCET_LIMIT_EXCEEDED");
    database.balances[owner] = (database.balances[owner] ?? 0) + amount;
    const entry = {
      id: randomUUID(),
      type: "FAUCET" as const,
      owner,
      amount,
      proof: protocolHash("faucet", owner, previousFaucet + amount),
      createdAt: new Date().toISOString(),
    };
    database.ledger.push(entry);
    return { balance: database.balances[owner], entry };
  });
}

export async function createStakePosition(owner: string, amount: number) {
  if (!Number.isFinite(amount) || amount < 1_000) throw new Error("MINIMUM_STAKE_1000");
  return updateDatabase((database) => {
    const balance = database.balances[owner] ?? 0;
    if (balance < amount) throw new Error("INSUFFICIENT_BALANCE");
    const now = new Date().toISOString();
    database.balances[owner] = balance - amount;
    const position = issueTaskCredit(
      { id: randomUUID(), owner, amount, activeTaskId: null, creditExpiresAt: null },
      now,
      database.config,
    );
    database.positions.push(position);
    database.ledger.push({
      id: randomUUID(),
      type: "STAKE",
      owner,
      amount: -amount,
      proof: protocolHash("stake", position.id, owner, amount),
      createdAt: now,
    });
    return { position, balance: database.balances[owner] };
  });
}

export async function refreshTaskCredit(owner: string, positionId: string) {
  return updateDatabase((database) => {
    const index = database.positions.findIndex((position) => position.id === positionId && position.owner === owner);
    if (index < 0) throw new Error("POSITION_NOT_FOUND");
    database.positions[index] = issueTaskCredit(database.positions[index], new Date().toISOString(), database.config);
    return database.positions[index];
  });
}

export async function createTask(input: z.infer<typeof createTaskSchema>) {
  const parsed = createTaskSchema.parse(input);
  return updateDatabase((database) => {
    const positionIndex = database.positions.findIndex(
      (position) => position.id === parsed.stakePositionId && position.owner === parsed.publisher,
    );
    if (positionIndex < 0) throw new Error("POSITION_NOT_FOUND");
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      title: parsed.title,
      description: parsed.description,
      category: parsed.category,
      executionMode: "COLLABORATION",
      publisher: parsed.publisher,
      stakePositionId: parsed.stakePositionId,
      state: "OPEN",
      maxExecutors: parsed.maxExecutors,
      declaredDurationHours: parsed.declaredDurationHours,
      createdAt: now,
      deadlineAt: addDays(now, Math.max(1, Math.ceil(parsed.declaredDurationHours / 24) + 2)),
      executorIds: [],
      testerId: null,
      testerSelectionProof: null,
      criteria: parsed.criteria.map((description, index) => ({ id: `criterion-${index + 1}`, description })),
      completionDefinition: parsed.completionDefinition,
      submission: null,
      testResult: null,
      rewardGrantId: null,
      maintenanceHealthy: [false, false, false],
    };
    database.positions[positionIndex] = consumeTaskCredit(database.positions[positionIndex], task.id, now);
    database.tasks.push(task);
    return task;
  });
}

export async function registerAgent(input: z.infer<typeof registerAgentSchema>) {
  const parsed = registerAgentSchema.parse(input);
  if (parsed.scopes?.some((scope) => !roleAllowsScope(parsed.role, scope))) throw new Error("AGENT_SCOPE_ROLE_MISMATCH");
  if (isProductionMode() && !parsed.stakePositionId) throw new Error("AGENT_STAKE_POSITION_REQUIRED");
  if (isProductionMode()) {
    const amount = await productionAgentStake(parsed.owner, parsed.stakePositionId!, parsed.role);
    const database = await readDatabase();
    if (amount < database.config.minAgentStake) throw new Error("INSUFFICIENT_AGENT_STAKE");
    if (database.agents.some((agent) => agent.stakePositionId === parsed.stakePositionId)) throw new Error("AGENT_STAKE_POSITION_ALREADY_BOUND");
    parsed.stake = amount;
  }
  const apiKey = `amp_${randomBytes(32).toString("base64url")}`;
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(apiKey, salt, 32) as Buffer).toString("hex");
  return updateDatabase((database) => {
    if (parsed.stakePositionId && database.agents.some((agent) => agent.stakePositionId === parsed.stakePositionId)) throw new Error("AGENT_STAKE_POSITION_ALREADY_BOUND");
    const agent: Agent = {
      id: `agent-${randomUUID()}`,
      ...parsed,
      apiKey: isProductionMode() ? undefined : apiKey,
      apiKeyHash: hash,
      apiKeySalt: salt,
      scopes: parsed.scopes ?? [...AGENT_ROLE_DEFAULT_SCOPES[parsed.role]],
      revokedAt: null,
      reputation: 50,
      completedTasks: 0,
      online: true,
    };
    database.agents.push(agent);
    return { agent: { ...agent, apiKey: undefined, apiKeyHash: undefined, apiKeySalt: undefined }, apiKey };
  });
}

export async function authenticateAgent(agentId: string, apiKey: string | null, requiredScope?: AgentScope) {
  const database = await readDatabase();
  const agent = database.agents.find((item) => item.id === agentId);
  if (!agent || !apiKey || agent.revokedAt) throw new Error("AGENT_AUTHENTICATION_FAILED");
  let authenticated = agent.apiKey === apiKey;
  if (!authenticated && agent.apiKeyHash && agent.apiKeySalt) {
    const candidate = await scrypt(apiKey, agent.apiKeySalt, 32) as Buffer;
    const expected = Buffer.from(agent.apiKeyHash, "hex");
    authenticated = candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }
  if (!authenticated) throw new Error("AGENT_AUTHENTICATION_FAILED");
  if (requiredScope && !(agent.scopes ?? []).includes(requiredScope) && isProductionMode()) throw new Error("AGENT_SCOPE_DENIED");
  if (!agent.online) throw new Error("AGENT_OFFLINE");
  if (isProductionMode()) {
    if (!agent.stakePositionId) throw new Error("AGENT_STAKE_POSITION_REQUIRED");
    const amount = await productionAgentStake(agent.owner, agent.stakePositionId, agent.role);
    if (amount < database.config.minAgentStake) throw new Error("INSUFFICIENT_AGENT_STAKE");
  }
  return agent;
}

async function productionAgentStake(owner: string, positionId: string, role?: AgentRole) {
  const config = runtimeConfig();
  const addresses = chainContractAddresses();
  const client = createPublicClient({ chain: bscTestnet, transport: http(config.BSC_TESTNET_RPC_URL) });
  const address = getAddress(owner);
  const [registeredPosition, eligible, capabilities, amount] = await Promise.all([
    client.readContract({ address: addresses.agentRegistry, abi: agentRegistryAbi, functionName: "agentPosition", args: [address] }),
    client.readContract({ address: addresses.agentRegistry, abi: agentRegistryAbi, functionName: "isEligible", args: [address] }),
    client.readContract({ address: addresses.agentRegistry, abi: agentRegistryAbi, functionName: "agentCapabilities", args: [address] }),
    client.readContract({ address: addresses.stakeManager, abi: stakeManagerAbi, functionName: "stakeOf", args: [BigInt(positionId)] }),
  ]);
  if (!eligible || registeredPosition !== BigInt(positionId)) throw new Error("AGENT_ONCHAIN_REGISTRATION_INVALID");
  const requiredCapabilities = role ? AGENT_ROLE_CAPABILITY_MASK[role] : 0;
  if (requiredCapabilities && (Number(capabilities) & requiredCapabilities) !== requiredCapabilities) throw new Error("AGENT_ONCHAIN_CAPABILITIES_MISMATCH");
  return Number(formatEther(amount));
}

export async function claimTask(taskId: string, agentId: string) {
  return updateDatabase((database) => {
    const task = database.tasks.find((item) => item.id === taskId);
    const agent = database.agents.find((item) => item.id === agentId);
    if (!task) throw new Error("TASK_NOT_FOUND");
    if (!agent) throw new Error("AGENT_NOT_FOUND");
    if (task.state !== "OPEN" && task.state !== "CLAIMED") throw new Error("TASK_NOT_CLAIMABLE");
    if (agent.role !== "EXECUTOR" && agent.role !== "BOTH") throw new Error("AGENT_CANNOT_EXECUTE");
    if (agent.owner === task.publisher) throw new Error("PUBLISHER_CANNOT_EXECUTE");
    if (agent.stake < database.config.minAgentStake) throw new Error("INSUFFICIENT_AGENT_STAKE");
    if (task.executorIds.includes(agentId)) return task;
    if (task.executorIds.length >= task.maxExecutors) throw new Error("EXECUTOR_LIMIT_REACHED");
    task.executorIds.push(agentId);
    task.state = "CLAIMED";
    return task;
  });
}

export async function submitWork(taskId: string, agentId: string, submission: { artifactUrl: string; artifactHash: string; summary: string }) {
  if (!submission.artifactHash.startsWith("sha256:")) throw new Error("INVALID_ARTIFACT_HASH");
  return updateDatabase((database) => {
    const task = database.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("TASK_NOT_FOUND");
    if (!task.executorIds.includes(agentId)) throw new Error("AGENT_NOT_ASSIGNED");
    if (task.state !== "CLAIMED" && task.state !== "SUBMITTED") throw new Error("TASK_NOT_SUBMITTABLE");
    task.submission = { ...submission, submittedAt: new Date().toISOString() };
    const selection = selectRandomTester(task, database.agents, protocolHash(task.id, submission.artifactHash, task.executorIds.join(",")));
    task.testerId = selection.tester.id;
    task.testerSelectionProof = selection.proof;
    task.state = "TESTING";
    return { task, tester: { id: selection.tester.id, name: selection.tester.name }, selectionProof: selection.proof };
  });
}

export async function submitTest(taskId: string, testerId: string, evidenceInput: SoftwareEvidence, selectionProof: string) {
  const evidence = softwareEvidenceSchema.parse(evidenceInput);
  return updateDatabase((database) => {
    const task = database.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("TASK_NOT_FOUND");
    if (task.state !== "TESTING") throw new Error("TASK_NOT_IN_TESTING");
    if (task.testerId !== testerId) throw new Error("TESTER_NOT_ASSIGNED");
    if (!task.submission || task.submission.artifactHash !== evidence.artifactHash) throw new Error("ARTIFACT_MISMATCH");
    const decision = validateSoftwareEvidence(evidence);
    task.testResult = {
      ...evidence,
      testerId,
      passed: decision.passed,
      failures: decision.failures,
      submittedAt: new Date().toISOString(),
      selectionProof,
    };
    task.state = decision.passed ? "USER_REVIEW" : "SUBMITTED";
    return task;
  });
}

export async function reviewTask(taskId: string, publisher: string, decision: "ACCEPT" | "REJECT", rejection?: { code?: string; criterionId?: string; evidenceHash?: string; detail?: string }) {
  return updateDatabase((database) => {
    const task = database.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("TASK_NOT_FOUND");
    if (task.publisher !== publisher) throw new Error("NOT_TASK_PUBLISHER");
    if (task.state !== "USER_REVIEW") throw new Error("TASK_NOT_IN_USER_REVIEW");
    const position = database.positions.find((item) => item.id === task.stakePositionId);
    if (!position) throw new Error("POSITION_NOT_FOUND");

    if (decision === "REJECT") {
      const validCriterion = rejection?.criterionId && task.criteria.some((criterion) => criterion.id === rejection.criterionId);
      const valid = rejection?.code && validCriterion && rejection?.evidenceHash?.startsWith("sha256:") && (rejection.detail?.trim().length ?? 0) >= 10;
      if (!valid) throw new Error("STRUCTURED_REJECTION_REQUIRED");
      task.state = "DISPUTED";
      return { task, rejection };
    }

    if (!task.testResult) throw new Error("TEST_RESULT_REQUIRED");
    const key = collaborationKey(task);
    const priorCount = database.collaborationCounts[key] ?? 0;
    const grant = validateAndCreateReward({
      task,
      position,
      testResult: task.testResult,
      config: database.config,
      priorCollaborationCount: priorCount,
      now: new Date().toISOString(),
    });
    database.config.epochRewardIssued += grant.total;
    database.rewards.push(grant);
    task.rewardGrantId = grant.id;
    task.state = "MAINTENANCE";
    return { task, grant };
  });
}

export async function completeMaintenance(taskId: string, publisher: string, checkpointIndex: number, healthy: boolean) {
  return updateDatabase((database) => {
    const task = database.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("TASK_NOT_FOUND");
    if (task.publisher !== publisher) throw new Error("NOT_TASK_PUBLISHER");
    if (task.state !== "MAINTENANCE") throw new Error("TASK_NOT_IN_MAINTENANCE");
    if (!Number.isInteger(checkpointIndex) || checkpointIndex < 0 || checkpointIndex > 2) throw new Error("INVALID_CHECKPOINT");
    const grant = database.rewards.find((item) => item.id === task.rewardGrantId);
    if (!grant) throw new Error("REWARD_GRANT_NOT_FOUND");
    const tranche = grant.tranches[checkpointIndex + 1];
    if (tranche.status !== "LOCKED") throw new Error("CHECKPOINT_ALREADY_RESOLVED");
    if (new Date(tranche.dueAt) > new Date()) throw new Error("CHECKPOINT_NOT_DUE");
    task.maintenanceHealthy[checkpointIndex] = healthy;
    tranche.status = healthy ? "CLAIMABLE" : "FAILED";
    if (!healthy) return { task, grant };
    if (task.maintenanceHealthy.every(Boolean)) {
      task.state = "COMPLETED";
      const positionIndex = database.positions.findIndex((item) => item.id === task.stakePositionId);
      database.positions[positionIndex] = releaseTaskSlot(database.positions[positionIndex], task.id);
      const key = collaborationKey(task);
      database.collaborationCounts[key] = (database.collaborationCounts[key] ?? 0) + 1;
      for (const agentId of task.executorIds) {
        const agent = database.agents.find((item) => item.id === agentId);
        if (agent) agent.completedTasks += 1;
      }
    }
    return { task, grant };
  });
}

export async function claimReward(taskId: string, trancheId: string) {
  return updateDatabase((database) => {
    const task = database.tasks.find((item) => item.id === taskId);
    const grant = database.rewards.find((item) => item.taskId === taskId);
    if (!task || !grant) throw new Error("REWARD_NOT_FOUND");
    const tranche = grant.tranches.find((item) => item.id === trancheId);
    if (!tranche) throw new Error("TRANCHE_NOT_FOUND");
    if (tranche.status !== "CLAIMABLE") throw new Error("TRANCHE_NOT_CLAIMABLE");
    const executorAgents = task.executorIds
      .map((id) => database.agents.find((agent) => agent.id === id))
      .filter((agent): agent is Agent => Boolean(agent));
    const tester = database.agents.find((agent) => agent.id === task.testerId);
    if (!executorAgents.length || !tester) throw new Error("REWARD_PARTICIPANTS_MISSING");
    const now = new Date().toISOString();
    const executorTotal = Math.floor(tranche.amount * 0.65 * 100) / 100;
    const perExecutor = Math.floor((executorTotal / executorAgents.length) * 100) / 100;
    const testerAmount = Math.floor(tranche.amount * 0.15 * 100) / 100;
    for (const agent of executorAgents) {
      database.balances[agent.owner] = (database.balances[agent.owner] ?? 0) + perExecutor;
      database.ledger.push({
        id: randomUUID(), type: "REWARD", owner: agent.owner, amount: perExecutor, taskId,
        proof: protocolHash(grant.issuanceProof, tranche.id, agent.id, perExecutor), createdAt: now,
      });
    }
    database.balances[tester.owner] = (database.balances[tester.owner] ?? 0) + testerAmount;
    database.ledger.push({
      id: randomUUID(), type: "REWARD", owner: tester.owner, amount: testerAmount, taskId,
      proof: protocolHash(grant.issuanceProof, tranche.id, tester.id, testerAmount), createdAt: now,
    });
    tranche.status = "CLAIMED";
    return { tranche, executorTotal, testerAmount, protocolReserve: tranche.amount - executorTotal - testerAmount };
  });
}
