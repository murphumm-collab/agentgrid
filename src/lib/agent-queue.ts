import { createClient, type RedisClientType } from "redis";
import { runtimeConfig } from "./env";
import { canonicalChainJobEvent, markJobOutboxDispatched, pendingJobOutbox } from "./store-postgres";
import { agentJobSchema, parseAgentJobCompletionResult, type AgentJob, type AgentJobRole } from "./agent-job-schema";

export type { AgentJob, AgentJobRole } from "./agent-job-schema";

let client: RedisClientType | undefined;
async function redis() {
  const url = runtimeConfig().REDIS_URL;
  if (!url) throw new Error("REDIS_URL_NOT_CONFIGURED");
  if (!client) {
    client = createClient({ url });
    client.on("error", () => undefined);
    await client.connect();
  }
  return client;
}

const queueKey = (role: AgentJobRole, target?: string) => `agentgrid:queue:${role}${target ? `:${target.toLowerCase()}` : ""}`;
const jobKey = (id: string) => `agentgrid:job:${id}`;
const leaseKey = (id: string) => `agentgrid:lease:${id}`;
const doneKey = (id: string) => `agentgrid:done:${id}`;
const leasesKey = "agentgrid:leases";
const completedJobRetentionSeconds = 30 * 24 * 60 * 60;
const maximumStoredJobBytes = 64 * 1024;

function parseStoredJob(raw: string) {
  if (Buffer.byteLength(raw) > maximumStoredJobBytes) throw new Error("AGENT_JOB_INVALID");
  try { return agentJobSchema.parse(JSON.parse(raw)); }
  catch { throw new Error("AGENT_JOB_INVALID"); }
}

function chainJobSource(job: AgentJob) {
  const { transactionHash, blockNumber, chainId, logIndex } = job.payload as Record<string, unknown>;
  if (typeof transactionHash !== "string" || typeof blockNumber !== "string") return null;
  return {
    transactionHash,
    blockNumber,
    chainId: typeof chainId === "number" && Number.isInteger(chainId) ? chainId : undefined,
    logIndex: typeof logIndex === "number" && Number.isInteger(logIndex) ? logIndex : undefined,
  };
}

function jobTarget(job: AgentJob) {
  if ((job.role === "TESTER" || job.role === "EVALUATOR") && "tester" in job.payload) return job.payload.tester;
  if (job.role === "EXECUTOR" && "executor" in job.payload) return job.payload.executor;
  return undefined;
}

async function chainJobIsCanonical(job: AgentJob) {
  const source = chainJobSource(job);
  return !source || canonicalChainJobEvent(source.transactionHash, source.blockNumber, source.chainId, source.logIndex);
}

async function finishLease(id: string, agentId: string, result: unknown) {
  const r = await redis();
  const completed = await r.eval(
    [
      "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end",
      "redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3])",
      "redis.call('EXPIRE',KEYS[3],ARGV[3])",
      "redis.call('DEL',KEYS[1])",
      "redis.call('ZREM',KEYS[4],ARGV[4])",
      "return 1",
    ].join("\n"),
    {
      keys: [leaseKey(id), doneKey(id), jobKey(id), leasesKey],
      arguments: [agentId, JSON.stringify({ agentId, result, completedAt: new Date().toISOString() }), String(completedJobRetentionSeconds), id],
    },
  );
  if (Number(completed) !== 1) throw new Error("JOB_LEASE_NOT_OWNED");
}

async function assertCanonicalLease(id: string, agentId: string) {
  const r = await redis();
  if (await r.get(leaseKey(id)) !== agentId) throw new Error("JOB_LEASE_NOT_OWNED");
  const raw = await r.get(jobKey(id));
  if (!raw) throw new Error("JOB_NOT_FOUND");
  let job: AgentJob;
  try { job = parseStoredJob(raw); }
  catch (error) {
    await finishLease(id, agentId, { discarded: "AGENT_JOB_INVALID" });
    throw error;
  }
  if (job.id !== id) {
    await finishLease(id, agentId, { discarded: "AGENT_JOB_ID_MISMATCH" });
    throw new Error("AGENT_JOB_INVALID");
  }
  if (await chainJobIsCanonical(job)) return job;
  const source = chainJobSource(job);
  await finishLease(id, agentId, { discarded: "CHAIN_EVENT_REWOUND", ...source });
  throw new Error("JOB_SOURCE_REWOUND");
}

async function completedResultMatches(id: string, agentId: string, input: unknown) {
  const r = await redis();
  const [rawJob, rawDone] = await Promise.all([r.get(jobKey(id)), r.get(doneKey(id))]);
  if (!rawJob || !rawDone || Buffer.byteLength(rawDone) > maximumStoredJobBytes) return false;
  try {
    const job = parseStoredJob(rawJob);
    if (job.id !== id || !await chainJobIsCanonical(job)) return false;
    const expected = parseAgentJobCompletionResult(job.kind, input);
    const stored = JSON.parse(rawDone) as { agentId?: unknown; result?: unknown };
    if (stored.agentId !== agentId) return false;
    const actual = parseAgentJobCompletionResult(job.kind, stored.result);
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch { return false; }
}

export async function enqueueAgentJob(input: AgentJob) {
  const job = agentJobSchema.parse(input);
  const r = await redis();
  const target = jobTarget(job);
  const created = await r.eval(
    "if redis.call('SET',KEYS[1],ARGV[1],'NX') then redis.call('LPUSH',KEYS[2],ARGV[2]); return 1 else return 0 end",
    { keys: [jobKey(job.id), queueKey(job.role, target)], arguments: [JSON.stringify(job), job.id] },
  );
  return Number(created) === 1;
}

export async function dispatchJobOutbox() {
  const rows = await pendingJobOutbox();
  for (const row of rows) {
    const createdAt = new Date(row.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error("AGENT_JOB_INVALID");
    await enqueueAgentJob(agentJobSchema.parse({ ...row, createdAt: createdAt.toISOString() }));
    await markJobOutboxDispatched(row.id);
  }
  return rows.length;
}

async function recoverExpiredLeases() {
  const r = await redis();
  const expired = await r.zRangeByScore(leasesKey, 0, Date.now(), { LIMIT: { offset: 0, count: 100 } });
  for (const id of expired) {
    if (!await r.exists(leaseKey(id)) && !await r.exists(doneKey(id))) {
      const raw = await r.get(jobKey(id));
      if (raw) {
        try {
          const job = parseStoredJob(raw);
          if (job.id !== id) throw new Error("AGENT_JOB_ID_MISMATCH");
          const target = jobTarget(job);
          await r.lPush(queueKey(job.role, target), id);
        } catch {
          await r.set(doneKey(id), JSON.stringify({ discarded: "AGENT_JOB_INVALID", completedAt: new Date().toISOString() }), { EX: completedJobRetentionSeconds });
          await r.del(jobKey(id));
        }
      }
    }
    await r.zRem(leasesKey, id);
  }
}

export async function leaseAgentJob(agentId: string, role: AgentJobRole, owner: string, discarded = 0): Promise<{ job: AgentJob; leaseSeconds: number } | null> {
  await recoverExpiredLeases();
  const r = await redis();
  const leaseMs = runtimeConfig().AGENT_LEASE_SECONDS * 1_000;
  const targeted = role === "TESTER" || role === "EVALUATOR" || role === "EXECUTOR" ? queueKey(role, owner) : queueKey(role);
  const general = queueKey(role);
  const leased = await r.eval([
    "for attempt=1,20 do",
    " local id=redis.call('RPOP',KEYS[1])",
    " if (not id) and KEYS[2]~=KEYS[1] then id=redis.call('RPOP',KEYS[2]) end",
    " if not id then return nil end",
    " if redis.call('EXISTS',ARGV[4]..id)==0 and redis.call('SET',ARGV[2]..id,ARGV[1],'NX','PX',ARGV[3]) then",
    "  local raw=redis.call('GET',ARGV[5]..id)",
    "  if raw then redis.call('ZADD',KEYS[3],ARGV[6],id); return {id,raw} end",
    "  redis.call('DEL',ARGV[2]..id)",
    " end",
    "end",
    "return nil",
  ].join("\n"), {
    keys: [targeted, general, leasesKey],
    arguments: [agentId, "agentgrid:lease:", String(leaseMs), "agentgrid:done:", "agentgrid:job:", String(Date.now() + leaseMs)],
  }) as [string, string] | null;
  if (!leased) return null;
  let job: AgentJob;
  try { job = parseStoredJob(leased[1]); }
  catch {
    await finishLease(leased[0], agentId, { discarded: "AGENT_JOB_INVALID" });
    return discarded < 20 ? leaseAgentJob(agentId, role, owner, discarded + 1) : null;
  }
  if (job.id !== leased[0] || job.role !== role) {
    await finishLease(leased[0], agentId, { discarded: "AGENT_JOB_ID_OR_ROLE_MISMATCH" });
    return discarded < 20 ? leaseAgentJob(agentId, role, owner, discarded + 1) : null;
  }
  if (!await chainJobIsCanonical(job)) {
    await finishLease(job.id, agentId, { discarded: "CHAIN_EVENT_REWOUND", ...chainJobSource(job) });
    return discarded < 20 ? leaseAgentJob(agentId, role, owner, discarded + 1) : null;
  }
  return { job, leaseSeconds: runtimeConfig().AGENT_LEASE_SECONDS };
}

export async function heartbeatAgentJob(id: string, agentId: string) {
  await assertCanonicalLease(id, agentId);
  const r = await redis();
  const leaseMs = runtimeConfig().AGENT_LEASE_SECONDS * 1_000;
  await r.pExpire(leaseKey(id), leaseMs);
  await r.zAdd(leasesKey, [{ score: Date.now() + leaseMs, value: id }]);
  return { leaseSeconds: runtimeConfig().AGENT_LEASE_SECONDS };
}

export async function completeAgentJob(id: string, agentId: string, result: unknown) {
  let job: AgentJob;
  try { job = await assertCanonicalLease(id, agentId); }
  catch (error) {
    if (error instanceof Error && error.message === "JOB_LEASE_NOT_OWNED" && await completedResultMatches(id, agentId, result)) {
      return { completed: true };
    }
    throw error;
  }
  const parsedResult = parseAgentJobCompletionResult(job.kind, result);
  try { await finishLease(id, agentId, parsedResult); }
  catch (error) {
    if (!(error instanceof Error && error.message === "JOB_LEASE_NOT_OWNED" && await completedResultMatches(id, agentId, parsedResult))) throw error;
  }
  return { completed: true };
}

export async function redisReady() {
  return (await redis()).ping().then((value) => value === "PONG");
}

export async function operationalQueueMetrics() {
  const r = await redis();
  async function depth(role: AgentJobRole) {
    let total = 0;
    for await (const keys of r.scanIterator({ MATCH: `${queueKey(role)}*`, COUNT: 100 })) {
      for (const key of keys) total += await r.lLen(key);
    }
    return total;
  }
  const [executorQueued, testerQueued, evaluatorQueued, coordinatorQueued, activeLeases] = await Promise.all([
    depth("EXECUTOR"), depth("TESTER"), depth("EVALUATOR"), depth("COORDINATOR"), r.zCard(leasesKey),
  ]);
  return { executorQueued, testerQueued, evaluatorQueued, coordinatorQueued, activeLeases };
}

export async function closeRedisForTests() {
  if (client) await client.close();
  client = undefined;
}
