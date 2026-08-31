import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Agent, ProtocolDatabase, Task } from "./types";
import { DEFAULT_CONFIG, addDays, protocolHash } from "./protocol";
import { isProductionMode, runtimeConfig } from "./env";
import { readPostgresDatabase, updatePostgresDatabase } from "./store-postgres";

function demoDataDirectory() {
  const configured = runtimeConfig().DEMO_DATA_DIRECTORY;
  const directory = configured ? path.resolve(configured) : path.join(process.cwd(), ".data");
  if (directory === path.parse(directory).root) throw new Error("DEMO_DATA_DIRECTORY_INVALID");
  return directory;
}

function demoDataFile() {
  return path.join(demoDataDirectory(), "protocol.json");
}

export function seedDatabase(): ProtocolDatabase {
  const now = new Date().toISOString();
  const publisher = "0xDemoPublisher";
  const executorId = "agent-builder-01";
  const testerId = "agent-verifier-01";
  const agents: Agent[] = [
    {
      id: executorId,
      name: "Forge Code Agent",
      owner: "0xAgentBuilder",
      role: "EXECUTOR",
      capabilities: ["typescript", "smart-contracts", "testing"],
      endpoint: "http://localhost:3000/api/demo/executor",
      apiKey: "amp_demo_executor",
      stake: 1_500,
      reputation: 94,
      completedTasks: 18,
      online: true,
    },
    {
      id: testerId,
      name: "Sentinel Test Agent",
      owner: "0xAgentVerifier",
      role: "TESTER",
      capabilities: ["typescript", "coverage", "security"],
      endpoint: "http://localhost:3000/api/demo/tester",
      apiKey: "amp_demo_tester",
      stake: 2_000,
      reputation: 97,
      completedTasks: 31,
      online: true,
    },
    {
      id: "agent-verifier-02",
      name: "Proofline QA",
      owner: "0xProofline",
      role: "BOTH",
      capabilities: ["python", "api", "hidden-tests"],
      endpoint: "http://localhost:3000/api/demo/tester-2",
      apiKey: "amp_demo_proofline",
      stake: 1_200,
      reputation: 91,
      completedTasks: 12,
      online: true,
    },
  ];
  const task: Task = {
    id: "task-demo-001",
    title: "Build a wallet activity risk monitor",
    description: "Create a typed service that scores wallet activity and ships with deterministic tests and an operator dashboard.",
    category: "Development",
    executionMode: "COLLABORATION",
    publisher,
    stakePositionId: "position-demo-001",
    state: "OPEN",
    maxExecutors: 2,
    declaredDurationHours: 48,
    createdAt: now,
    deadlineAt: addDays(now, 7),
    executorIds: [],
    testerId: null,
    testerSelectionProof: null,
    criteria: [
      { id: "criterion-build", description: "The application builds without errors" },
      { id: "criterion-tests", description: "Public and hidden tests pass" },
      { id: "criterion-coverage", description: "Critical branch coverage is at least 95%" },
    ],
    submission: null,
    testResult: null,
    rewardGrantId: null,
    maintenanceHealthy: [false, false, false],
  };
  const additionalTasks: Task[] = [
    { title: "Audit a treasury access-control contract", description: "Review privileged roles, timelocks, upgrade paths and emergency controls for a DAO treasury contract, then deliver reproducible exploit tests and remediation patches.", category: "Security", executionMode: "COMPETITION" as const, hours: 40, executors: 3 },
    { title: "Build a multilingual support triage Agent", description: "Classify incoming customer tickets, route high-risk cases to people, draft grounded replies from the approved knowledge base and report resolution-quality metrics.", category: "AI & Agents", executionMode: "COLLABORATION" as const, hours: 72, executors: 4 },
    { title: "Create a retail churn analytics pipeline", description: "Ingest weekly commerce events, produce explainable churn-risk segments and publish a monitored dashboard that business operators can use for retention campaigns.", category: "Data", executionMode: "COLLABORATION" as const, hours: 96, executors: 3 },
    { title: "Automate Kubernetes release verification", description: "Implement a staged deployment workflow with signed images, smoke tests, rollback checks and an operator report suitable for a production release decision.", category: "DevOps", executionMode: "COMPETITION" as const, hours: 48, executors: 3 },
    { title: "Redesign mobile merchant onboarding", description: "Deliver an accessible mobile-first onboarding flow, clickable states and usability evidence that reduces incomplete verification without weakening compliance controls.", category: "Design", executionMode: "COLLABORATION" as const, hours: 56, executors: 2 },
    { title: "Localize the operator knowledge base", description: "Translate and restructure the incident-response knowledge base for Chinese and English operators, preserving technical meaning and validating every runbook link.", category: "Content", executionMode: "COLLABORATION" as const, hours: 36, executors: 2 },
    { title: "Research stablecoin settlement providers", description: "Compare regulated settlement providers across coverage, custody model, pricing, operational risk and integration effort, with source-backed recommendations for a launch decision.", category: "Research", executionMode: "COMPETITION" as const, hours: 32, executors: 4 },
    { title: "Design a partner-led growth experiment", description: "Define partner segments, measurable activation events, outreach assets and a four-week experiment plan with an auditable attribution dashboard.", category: "Marketing", executionMode: "COLLABORATION" as const, hours: 44, executors: 3 },
    { title: "Implement a milestone escrow contract", description: "Build and test a BSC escrow contract with milestone approvals, dispute timeouts, emergency recovery and complete deployment documentation.", category: "Web3", executionMode: "COMPETITION" as const, hours: 80, executors: 4 },
  ].map((definition, index) => ({
    ...task,
    id: `task-demo-${String(index + 2).padStart(3, "0")}`,
    title: definition.title,
    description: definition.description,
    category: definition.category,
    executionMode: definition.executionMode,
    publisher: `0xDemoPublisher${index + 2}`,
    stakePositionId: `position-demo-${String(index + 2).padStart(3, "0")}`,
    maxExecutors: definition.executors,
    declaredDurationHours: definition.hours,
    deadlineAt: addDays(now, Math.ceil(definition.hours / 24) + 3),
  }));
  const tasks = [task, ...additionalTasks];
  const positions = tasks.map((item, index) => ({
    id: item.stakePositionId,
    owner: item.publisher,
    amount: 1_000 + index * 250,
    activeTaskId: item.id,
    creditExpiresAt: null,
  }));
  return {
    config: { ...DEFAULT_CONFIG },
    balances: { [publisher]: 49_000, "0xAgentBuilder": 10_000, "0xAgentVerifier": 10_000 },
    positions,
    agents,
    tasks,
    rewards: [],
    ledger: [
      { id: randomUUID(), type: "FAUCET", owner: publisher, amount: 50_000, proof: protocolHash("seed", publisher), createdAt: now },
      { id: randomUUID(), type: "STAKE", owner: publisher, amount: -1_000, proof: protocolHash("stake", publisher), createdAt: now },
    ],
    collaborationCounts: {},
  };
}

export function emptyDatabase(): ProtocolDatabase {
  return { config: { ...DEFAULT_CONFIG }, balances: {}, positions: [], agents: [], tasks: [], rewards: [], ledger: [], collaborationCounts: {} };
}

let writeQueue: Promise<void> = Promise.resolve();

async function ensureDatabase(): Promise<void> {
  const directory = demoDataDirectory();
  const filename = demoDataFile();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.access(filename);
  } catch {
    await fs.writeFile(filename, JSON.stringify(seedDatabase(), null, 2), { encoding: "utf8", mode: 0o600 });
  }
}

export async function readDatabase(): Promise<ProtocolDatabase> {
  if (isProductionMode()) return readPostgresDatabase(emptyDatabase());
  await ensureDatabase();
  return JSON.parse(await fs.readFile(demoDataFile(), "utf8")) as ProtocolDatabase;
}

export async function updateDatabase<T>(mutation: (database: ProtocolDatabase) => T | Promise<T>): Promise<T> {
  if (isProductionMode()) return updatePostgresDatabase(emptyDatabase(), mutation);
  const operation = writeQueue.catch(() => undefined).then(async () => {
    const database = await readDatabase();
    const result = await mutation(database);
    const filename = demoDataFile();
    const temporary = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(database, null, 2), "utf8");
    await fs.rename(temporary, filename);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function resetDatabase(): Promise<void> {
  const directory = demoDataDirectory();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(demoDataFile(), JSON.stringify(seedDatabase(), null, 2), { encoding: "utf8", mode: 0o600 });
}
