import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { runtimeConfig } from "./env";
import { canonicalChainJobEvent, markJobOutboxDispatched, pendingJobOutbox } from "./store-postgres";
import { agentJobSchema, parseAgentJobCompletionResult, type AgentJob, type AgentJobRole } from "./agent-job-schema";
import {
  schedulingLaneForJob,
  validateSchedulingBinding,
  type SchedulingBinding,
  type SchedulingLane,
} from "./paid-scheduling";

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
const priorityExecutorQueueKey = "agentgrid:queue:EXECUTOR:priority";
const jobKey = (id: string) => `agentgrid:job:${id}`;
const schedulingBindingKey = (id: string) => `agentgrid:scheduling:${id}`;
const leaseKey = (id: string) => `agentgrid:lease:${id}`;
const doneKey = (id: string) => `agentgrid:done:${id}`;
const recoveryLockKey = (id: string) => `agentgrid:recovery:${id}`;
const leasesKey = "agentgrid:leases";
const paidSchedulingCursorKey = "agentgrid:scheduling:executor:consecutive-priority";
const paidSchedulingLockKey = "agentgrid:scheduling:executor:lock";
const completedJobRetentionSeconds = 30 * 24 * 60 * 60;
const maximumStoredJobBytes = 64 * 1024;
const schedulingLockMilliseconds = 30_000;

const standardSchedulingBinding = {
  schedulingClass: "STANDARD",
  schedulingAttestationHash: null,
} as const satisfies SchedulingBinding;

function normalizedSchedulingBinding(input: SchedulingBinding): SchedulingBinding {
  const binding = validateSchedulingBinding(input);
  return binding.schedulingClass === "STANDARD" ? standardSchedulingBinding : {
    schedulingClass: binding.schedulingClass,
    schedulingAttestationHash: binding.schedulingAttestationHash!.toLowerCase() as `0x${string}`,
  };
}

function parseStoredSchedulingBinding(raw: string | null) {
  // Before paid scheduling existed, stored jobs had no companion key. They can
  // only have been organic, so absence is the one backward-compatible STANDARD
  // case. A present empty or malformed value remains invalid and is quarantined.
  if (raw === null) return standardSchedulingBinding;
  if (!raw || Buffer.byteLength(raw) > 512) throw new Error("AGENT_JOB_SCHEDULING_BINDING_INVALID");
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "schedulingAttestationHash,schedulingClass") {
      throw new Error("AGENT_JOB_SCHEDULING_BINDING_INVALID");
    }
    return normalizedSchedulingBinding(value as unknown as SchedulingBinding);
  } catch {
    throw new Error("AGENT_JOB_SCHEDULING_BINDING_INVALID");
  }
}

function queueForStoredJob(job: AgentJob, binding: SchedulingBinding) {
  const lane = schedulingLaneForJob(job, binding);
  if (lane === "PRIORITY") return priorityExecutorQueueKey;
  const target = jobTarget(job);
  return queueKey(job.role, target);
}

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
      "redis.call('EXPIRE',KEYS[5],ARGV[3])",
      "redis.call('DEL',KEYS[1])",
      "redis.call('ZREM',KEYS[4],ARGV[4])",
      "return 1",
    ].join("\n"),
    {
      keys: [leaseKey(id), doneKey(id), jobKey(id), leasesKey, schedulingBindingKey(id)],
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

type EnqueueOutcome = "CREATED" | "IDENTICAL";

async function enqueueWithSchedulingBinding(input: AgentJob, schedulingInput: SchedulingBinding): Promise<EnqueueOutcome> {
  const job = agentJobSchema.parse(input);
  const binding = normalizedSchedulingBinding(schedulingInput);
  const lane = schedulingLaneForJob(job, binding);
  const r = await redis();
  const rawJob = JSON.stringify(job);
  const rawBinding = JSON.stringify(binding);
  const targetQueue = lane === "PRIORITY" ? priorityExecutorQueueKey : queueKey(job.role, jobTarget(job));
  const created = await r.eval(
    [
      "local existing=redis.call('GET',KEYS[1])",
      "if existing then",
      " if existing~=ARGV[1] then return -1 end",
      " local existingBinding=redis.call('GET',KEYS[2])",
      " if (not existingBinding) or existingBinding~=ARGV[2] then return -2 end",
      " return 0",
      "end",
      "redis.call('SET',KEYS[1],ARGV[1])",
      "redis.call('SET',KEYS[2],ARGV[2])",
      "redis.call('LPUSH',KEYS[3],ARGV[3])",
      "return 1",
    ].join("\n"),
    { keys: [jobKey(job.id), schedulingBindingKey(job.id), targetQueue], arguments: [rawJob, rawBinding, job.id] },
  );
  if (Number(created) === -1) throw new Error("AGENT_JOB_ID_CONFLICT");
  if (Number(created) === -2) throw new Error("AGENT_JOB_SCHEDULING_BINDING_CONFLICT");
  return Number(created) === 1 ? "CREATED" : "IDENTICAL";
}

/** Public and maintenance producers can enqueue only the organic scheduling class. */
export async function enqueueAgentJob(input: AgentJob) {
  return await enqueueWithSchedulingBinding(input, standardSchedulingBinding) === "CREATED";
}

export async function dispatchJobOutbox() {
  const rows = await pendingJobOutbox();
  for (const row of rows) {
    const createdAt = new Date(row.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error("AGENT_JOB_INVALID");
    const job = agentJobSchema.parse({
      id: row.id, role: row.role, kind: row.kind, payload: row.payload, createdAt: createdAt.toISOString(),
    });
    const binding = normalizedSchedulingBinding({
      schedulingClass: row.schedulingClass,
      schedulingAttestationHash: row.schedulingAttestationHash as `0x${string}` | null,
    });
    await enqueueWithSchedulingBinding(job, binding);
    if (!await markJobOutboxDispatched(row.id, binding.schedulingClass, binding.schedulingAttestationHash)) {
      throw new Error("AGENT_JOB_OUTBOX_BINDING_CHANGED");
    }
  }
  return rows.length;
}

async function recoverExpiredLeases() {
  const r = await redis();
  const expired = await r.zRangeByScore(leasesKey, 0, Date.now(), { LIMIT: { offset: 0, count: 100 } });
  for (const id of expired) {
    const recoveryToken = randomUUID();
    if (!await r.set(recoveryLockKey(id), recoveryToken, { NX: true, PX: schedulingLockMilliseconds })) continue;
    try {
      const [leaseExists, doneExists, rawJob, rawBinding] = await Promise.all([
        r.exists(leaseKey(id)), r.exists(doneKey(id)), r.get(jobKey(id)), r.get(schedulingBindingKey(id)),
      ]);
      if (leaseExists) continue;
      if (doneExists) {
        await r.zRem(leasesKey, id);
        continue;
      }
      if (!rawJob) throw new Error("AGENT_JOB_NOT_FOUND");
      const job = parseStoredJob(rawJob);
      if (job.id !== id) throw new Error("AGENT_JOB_ID_MISMATCH");
      const binding = parseStoredSchedulingBinding(rawBinding);
      const destination = queueForStoredJob(job, binding);
      const restored = await r.eval([
        "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end",
        "if redis.call('EXISTS',KEYS[2])==1 or redis.call('EXISTS',KEYS[3])==1 then return 0 end",
        "if not redis.call('ZSCORE',KEYS[4],ARGV[2]) then return 0 end",
        "redis.call('LPUSH',KEYS[5],ARGV[2])",
        "redis.call('ZREM',KEYS[4],ARGV[2])",
        "redis.call('DEL',KEYS[1])",
        "return 1",
      ].join("\n"), {
        keys: [recoveryLockKey(id), leaseKey(id), doneKey(id), leasesKey, destination],
        arguments: [recoveryToken, id],
      });
      if (Number(restored) !== 1) await r.zRem(leasesKey, id);
    } catch {
      await r.eval([
        "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end",
        "redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3])",
        "redis.call('DEL',KEYS[3],KEYS[4],KEYS[5])",
        "redis.call('ZREM',KEYS[6],ARGV[4])",
        "return 1",
      ].join("\n"), {
        keys: [recoveryLockKey(id), doneKey(id), jobKey(id), schedulingBindingKey(id), leaseKey(id), leasesKey],
        arguments: [recoveryToken, JSON.stringify({ discarded: "AGENT_JOB_INVALID", completedAt: new Date().toISOString() }), String(completedJobRetentionSeconds), id],
      });
    } finally {
      await r.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", {
        keys: [recoveryLockKey(id)], arguments: [recoveryToken],
      });
    }
  }
}

type ReservedLease = { id: string; rawJob: string; rawBinding: string | null };

async function reserveFromQueue(agentId: string, sourceQueue: string, leaseMs: number): Promise<ReservedLease | null> {
  const r = await redis();
  const leased = await r.eval([
    "for attempt=1,20 do",
    " local id=redis.call('RPOP',KEYS[1])",
    " if not id then return nil end",
    " if redis.call('EXISTS',ARGV[4]..id)==0 and redis.call('SET',ARGV[2]..id,ARGV[1],'NX','PX',ARGV[3]) then",
    "  local raw=redis.call('GET',ARGV[5]..id)",
    "  if raw then",
    "   redis.call('ZADD',KEYS[2],ARGV[7],id)",
    "   local binding=redis.call('GET',ARGV[6]..id)",
    "   return {id,raw,binding or '',binding and '1' or '0'}",
    "  end",
    "  redis.call('DEL',ARGV[2]..id)",
    " end",
    "end",
    "return nil",
  ].join("\n"), {
    keys: [sourceQueue, leasesKey],
    arguments: [agentId, "agentgrid:lease:", String(leaseMs), "agentgrid:done:", "agentgrid:job:", "agentgrid:scheduling:", String(Date.now() + leaseMs)],
  }) as [string, string, string, "0" | "1"] | null;
  return leased ? { id: leased[0], rawJob: leased[1], rawBinding: leased[3] === "1" ? leased[2] : null } : null;
}

async function reserveGeneralExecutorLease(agentId: string, leaseMs: number) {
  const r = await redis();
  const lockToken = randomUUID();
  const leased = await r.eval([
    "if not redis.call('SET',KEYS[5],ARGV[1],'NX','PX',ARGV[2]) then return {'LOCKED'} end",
    "local cursorRaw=redis.call('GET',KEYS[4])",
    "local cursor=cursorRaw and tonumber(cursorRaw) or 0",
    "if (not cursor) or cursor<0 or cursor>3 or cursor~=math.floor(cursor) then redis.call('DEL',KEYS[5]); return {'STATE_INVALID'} end",
    "local hasPriority=redis.call('LLEN',KEYS[1])>0",
    "local hasStandard=redis.call('LLEN',KEYS[2])>0",
    "if (not hasPriority) and (not hasStandard) then redis.call('DEL',KEYS[5]); return nil end",
    "local lane",
    "local source",
    "if hasPriority and hasStandard then",
    " if cursor>=3 then lane='STANDARD'; source=KEYS[2] else lane='PRIORITY'; source=KEYS[1] end",
    "elseif hasPriority then lane='PRIORITY'; source=KEYS[1] else lane='STANDARD'; source=KEYS[2] end",
    "for attempt=1,20 do",
    " local id=redis.call('RPOP',source)",
    " if not id then redis.call('DEL',KEYS[5]); return nil end",
    " if redis.call('EXISTS',ARGV[6]..id)==0 and redis.call('SET',ARGV[4]..id,ARGV[3],'NX','PX',ARGV[5]) then",
    "  local raw=redis.call('GET',ARGV[7]..id)",
    "  if raw then",
    "   redis.call('ZADD',KEYS[3],ARGV[9],id)",
    "   local binding=redis.call('GET',ARGV[8]..id)",
    "   return {id,raw,binding or '',binding and '1' or '0',lane,ARGV[1]}",
    "  end",
    "  redis.call('DEL',ARGV[4]..id)",
    " end",
    "end",
    "redis.call('DEL',KEYS[5])",
    "return nil",
  ].join("\n"), {
    keys: [priorityExecutorQueueKey, queueKey("EXECUTOR"), leasesKey, paidSchedulingCursorKey, paidSchedulingLockKey],
    arguments: [lockToken, String(schedulingLockMilliseconds), agentId, "agentgrid:lease:", String(leaseMs), "agentgrid:done:",
      "agentgrid:job:", "agentgrid:scheduling:", String(Date.now() + leaseMs)],
  }) as [string, string?, string?, string?, SchedulingLane?, string?] | null;
  if (!leased) return null;
  if (leased[0] === "LOCKED") return { locked: true as const };
  if (leased[0] === "STATE_INVALID") throw new Error("PRIORITY_SCHEDULING_STATE_INVALID");
  return {
    locked: false as const,
    id: leased[0], rawJob: leased[1]!, rawBinding: leased[3] === "1" ? leased[2]! : null,
    lane: leased[4] as "PRIORITY" | "STANDARD", lockToken: leased[5]!,
  };
}

async function releasePaidSchedulingLock(lockToken: string) {
  const r = await redis();
  await r.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", {
    keys: [paidSchedulingLockKey], arguments: [lockToken],
  });
}

async function confirmGeneralExecutorLease(id: string, agentId: string, lane: "PRIORITY" | "STANDARD", lockToken: string) {
  const r = await redis();
  const confirmed = await r.eval([
    "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end",
    "if redis.call('GET',KEYS[2])~=ARGV[2] or not redis.call('ZSCORE',KEYS[3],ARGV[3]) then return 0 end",
    "local cursorRaw=redis.call('GET',KEYS[4])",
    "local cursor=cursorRaw and tonumber(cursorRaw) or 0",
    "if (not cursor) or cursor<0 or cursor>3 or cursor~=math.floor(cursor) then return -1 end",
    "if ARGV[4]=='PRIORITY' then redis.call('SET',KEYS[4],math.min(3,cursor+1)) else redis.call('SET',KEYS[4],0) end",
    "redis.call('DEL',KEYS[1])",
    "return 1",
  ].join("\n"), {
    keys: [paidSchedulingLockKey, leaseKey(id), leasesKey, paidSchedulingCursorKey],
    arguments: [lockToken, agentId, id, lane],
  });
  if (Number(confirmed) === -1) throw new Error("PRIORITY_SCHEDULING_STATE_INVALID");
  if (Number(confirmed) !== 1) throw new Error("AGENT_JOB_SCHEDULING_CONFIRMATION_FAILED");
}

function validateReservedLease(reserved: ReservedLease, role: AgentJobRole, expectedTarget?: string) {
  const job = parseStoredJob(reserved.rawJob);
  if (job.id !== reserved.id || job.role !== role) throw new Error("AGENT_JOB_ID_OR_ROLE_MISMATCH");
  const binding = parseStoredSchedulingBinding(reserved.rawBinding);
  if (expectedTarget !== undefined && jobTarget(job)?.toLowerCase() !== expectedTarget.toLowerCase()) {
    throw new Error("AGENT_JOB_TARGET_MISMATCH");
  }
  return { job, binding };
}

export async function leaseAgentJob(agentId: string, role: AgentJobRole, owner: string, discarded = 0): Promise<{ job: AgentJob; leaseSeconds: number } | null> {
  await recoverExpiredLeases();
  const leaseMs = runtimeConfig().AGENT_LEASE_SECONDS * 1_000;

  if (role === "EXECUTOR" || role === "TESTER" || role === "EVALUATOR") {
    const targeted = await reserveFromQueue(agentId, queueKey(role, owner), leaseMs);
    if (targeted) {
      let validated: ReturnType<typeof validateReservedLease>;
      try {
        validated = validateReservedLease(targeted, role, owner);
        if (validated.binding.schedulingClass !== "STANDARD") throw new Error("AGENT_JOB_TARGET_PRIORITY_FORBIDDEN");
      } catch {
        await finishLease(targeted.id, agentId, { discarded: "AGENT_JOB_INVALID" });
        return discarded < 20 ? leaseAgentJob(agentId, role, owner, discarded + 1) : null;
      }
      if (!await chainJobIsCanonical(validated.job)) {
        await finishLease(validated.job.id, agentId, { discarded: "CHAIN_EVENT_REWOUND", ...chainJobSource(validated.job) });
        return discarded < 20 ? leaseAgentJob(agentId, role, owner, discarded + 1) : null;
      }
      return { job: validated.job, leaseSeconds: runtimeConfig().AGENT_LEASE_SECONDS };
    }
    if (role !== "EXECUTOR") return null;
  }

  if (role === "EXECUTOR") {
    const reserved = await reserveGeneralExecutorLease(agentId, leaseMs);
    if (!reserved || reserved.locked) return null;
    let validated: ReturnType<typeof validateReservedLease>;
    try {
      validated = validateReservedLease(reserved, role);
      const actualLane = schedulingLaneForJob(validated.job, validated.binding);
      if (actualLane !== reserved.lane || jobTarget(validated.job)) throw new Error("AGENT_JOB_SCHEDULING_LANE_MISMATCH");
    } catch {
      try { await finishLease(reserved.id, agentId, { discarded: "AGENT_JOB_INVALID" }); }
      finally { await releasePaidSchedulingLock(reserved.lockToken); }
      return discarded < 20 ? leaseAgentJob(agentId, role, owner, discarded + 1) : null;
    }
    let canonical: boolean;
    try { canonical = await chainJobIsCanonical(validated.job); }
    catch (error) {
      await releasePaidSchedulingLock(reserved.lockToken);
      throw error;
    }
    if (!canonical) {
      try { await finishLease(validated.job.id, agentId, { discarded: "CHAIN_EVENT_REWOUND", ...chainJobSource(validated.job) }); }
      finally { await releasePaidSchedulingLock(reserved.lockToken); }
      return discarded < 20 ? leaseAgentJob(agentId, role, owner, discarded + 1) : null;
    }
    try { await confirmGeneralExecutorLease(validated.job.id, agentId, reserved.lane, reserved.lockToken); }
    catch (error) {
      // An expired/lost fairness lock makes the Lua confirmation return before
      // touching the cursor. Keep the provisional lease and its ZSET entry so
      // normal expiry recovery restores the immutable stored lane.
      await releasePaidSchedulingLock(reserved.lockToken);
      throw error;
    }
    return { job: validated.job, leaseSeconds: runtimeConfig().AGENT_LEASE_SECONDS };
  }

  const general = await reserveFromQueue(agentId, queueKey(role), leaseMs);
  if (!general) return null;
  let validated: ReturnType<typeof validateReservedLease>;
  try {
    validated = validateReservedLease(general, role);
    if (validated.binding.schedulingClass !== "STANDARD" || jobTarget(validated.job)) throw new Error("AGENT_JOB_GENERAL_BINDING_INVALID");
  } catch {
    await finishLease(general.id, agentId, { discarded: "AGENT_JOB_INVALID" });
    return discarded < 20 ? leaseAgentJob(agentId, role, owner, discarded + 1) : null;
  }
  if (!await chainJobIsCanonical(validated.job)) {
    await finishLease(validated.job.id, agentId, { discarded: "CHAIN_EVENT_REWOUND", ...chainJobSource(validated.job) });
    return discarded < 20 ? leaseAgentJob(agentId, role, owner, discarded + 1) : null;
  }
  return { job: validated.job, leaseSeconds: runtimeConfig().AGENT_LEASE_SECONDS };
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
