import { createClient, type RedisClientType } from "redis";
import { runtimeConfig } from "./env";
import { canonicalChainJobEvent, markJobOutboxDispatched, pendingJobOutbox } from "./store-postgres";

export type AgentJobRole = "EXECUTOR" | "TESTER" | "EVALUATOR" | "COORDINATOR";
export interface AgentJob { id: string; role: AgentJobRole; kind: string; payload: Record<string, unknown>; createdAt: string }

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

function chainJobSource(job: AgentJob) {
  const { transactionHash, blockNumber, chainId, logIndex } = job.payload;
  if (typeof transactionHash !== "string" || typeof blockNumber !== "string") return null;
  return {
    transactionHash,
    blockNumber,
    chainId: typeof chainId === "number" && Number.isInteger(chainId) ? chainId : undefined,
    logIndex: typeof logIndex === "number" && Number.isInteger(logIndex) ? logIndex : undefined,
  };
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
  const job = JSON.parse(raw) as AgentJob;
  if (await chainJobIsCanonical(job)) return job;
  const source = chainJobSource(job);
  await finishLease(id, agentId, { discarded: "CHAIN_EVENT_REWOUND", ...source });
  throw new Error("JOB_SOURCE_REWOUND");
}

export async function enqueueAgentJob(job: AgentJob, retryCompleted = false) {
  const r = await redis();
  const target = (job.role === "TESTER" || job.role === "EVALUATOR") && typeof job.payload.tester === "string" ? job.payload.tester
    : job.role === "EXECUTOR" && typeof job.payload.executor === "string" ? job.payload.executor : undefined;
  const created = await r.eval(
    [
      // Only a scheduler that verified canonical, unapproved chain state may
      // redrive a completed job (e.g. its transaction was subsequently reorged).
      "if ARGV[3]=='1' and redis.call('EXISTS',KEYS[3])==1 and redis.call('EXISTS',KEYS[4])==0 then",
      " redis.call('DEL',KEYS[1],KEYS[3])",
      "end",
      "if redis.call('SET',KEYS[1],ARGV[1],'NX') then redis.call('LPUSH',KEYS[2],ARGV[2]); return 1 else return 0 end",
    ].join("\n"),
    { keys: [jobKey(job.id), queueKey(job.role, target), doneKey(job.id), leaseKey(job.id)], arguments: [JSON.stringify(job), job.id, retryCompleted ? "1" : "0"] },
  );
  return Number(created) === 1;
}

export async function dispatchJobOutbox() {
  const rows = await pendingJobOutbox();
  for (const row of rows) {
    await enqueueAgentJob(row as AgentJob);
    await markJobOutboxDispatched(row.id);
  }
  return rows.length;
}

async function recoverExpiredLeases() {
  const r = await redis();
  const expired = await r.zRangeByScore(leasesKey, 0, Date.now(), { LIMIT: { offset: 0, count: 100 } });
  for (const id of expired) {
    // Recheck expiry, enqueue, and remove the recovery entry atomically.
    // A concurrent heartbeat or new lease must never lose its recovery index.
    await r.eval([
      "local score=redis.call('ZSCORE',KEYS[1],ARGV[1])",
      "if not score or tonumber(score)>tonumber(ARGV[2]) then return 0 end",
      "if redis.call('EXISTS',KEYS[2])==1 then return 0 end",
      "if redis.call('EXISTS',KEYS[3])==0 then",
      " local raw=redis.call('GET',KEYS[4])",
      " if raw then",
      "  local job=cjson.decode(raw)",
      "  local target=nil",
      "  if job.role=='TESTER' or job.role=='EVALUATOR' then target=job.payload.tester end",
      "  if job.role=='EXECUTOR' then target=job.payload.executor end",
      "  local queue='agentgrid:queue:'..job.role",
      "  if type(target)=='string' then queue=queue..':'..string.lower(target) end",
      "  redis.call('LPUSH',queue,ARGV[1])",
      " end",
      "end",
      "redis.call('ZREM',KEYS[1],ARGV[1])",
      "return 1",
    ].join("\n"), { keys: [leasesKey, leaseKey(id), doneKey(id), jobKey(id)], arguments: [id, String(Date.now())] });
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
  const job = JSON.parse(leased[1]) as AgentJob;
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
  // The lease TTL and its recovery index are one invariant. If the process
  // crashes between separate PEXPIRE/ZADD calls, a renewed lease can later
  // expire without appearing in the recovery set and the job is lost forever.
  const renewed = await r.eval(
    [
      "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end",
      "redis.call('PEXPIRE',KEYS[1],ARGV[2])",
      "redis.call('ZADD',KEYS[2],ARGV[3],ARGV[4])",
      "return 1",
    ].join("\n"),
    {
      keys: [leaseKey(id), leasesKey],
      arguments: [agentId, String(leaseMs), String(Date.now() + leaseMs), id],
    },
  );
  if (Number(renewed) !== 1) throw new Error("JOB_LEASE_NOT_OWNED");
  return { leaseSeconds: runtimeConfig().AGENT_LEASE_SECONDS };
}

export async function completeAgentJob(id: string, agentId: string, result: unknown) {
  await assertCanonicalLease(id, agentId);
  await finishLease(id, agentId, result);
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
