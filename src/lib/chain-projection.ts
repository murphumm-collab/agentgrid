import { formatEther } from "viem";
import type { AgentQuality, AgentRoleQuality, EconomicsVesting, ProtocolEconomicsSummary, RewardGrant, StakePosition, Task, TaskEconomics } from "./types";
import { verificationTypes, type TaskDefinition } from "./task-definition";
import { TESTER_VERIFICATION_CAPABILITY_MASK } from "./agent-roles";
import type { ChainProjectionRow, CommitmentProjectionRow } from "./store-postgres";

type Args = Record<string, string | number | boolean | Array<string | number | boolean>>;

const scalar = (value: Args[string] | undefined) => Array.isArray(value) ? undefined : value;
const id = (args: Args, key: string) => String(scalar(args[key]) ?? "");
const tokens = (value: Args[string] | undefined) => Number(formatEther(BigInt(String(scalar(value) ?? 0))));
const iso = (value: string) => new Date(value).toISOString();
const plusDays = (value: string, days: number) => new Date(new Date(value).getTime() + days * 86_400_000).toISOString();

export function projectAgentStatuses(events: ChainProjectionRow[]) {
  const statuses = new Map<string, boolean>();
  for (const event of events) {
    if (event.eventName !== "AgentStatusUpdated") continue;
    const args = event.eventArgs ?? {};
    const agent = id(args, "agent").toLowerCase();
    if (agent) statuses.set(agent, scalar(args.active) === true);
  }
  return statuses;
}

const initialRoleQuality = (): AgentRoleQuality => ({ scoreBps: 5_000, outcomeCount: 0, severeFaults: 0, cooldownUntil: null, banned: false });
export const initialAgentQuality = (): AgentQuality => ({ executor: initialRoleQuality(), validator: initialRoleQuality(), evaluator: initialRoleQuality() });

export function projectAgentQualities(events: ChainProjectionRow[]) {
  const qualities = new Map<string, AgentQuality>();
  const roleKey = (role: number): keyof AgentQuality | undefined => role === 1 ? "executor" : role === 2 ? "validator" : role === 4 ? "evaluator" : undefined;
  for (const event of events) {
    if (event.eventName !== "AgentQualityUpdated" && event.eventName !== "AgentRoleRehabilitated") continue;
    const args = event.eventArgs ?? {};
    const agent = id(args, "agent").toLowerCase();
    const key = roleKey(Number(scalar(args.role)));
    if (!agent || !key) continue;
    const quality = qualities.get(agent) ?? initialAgentQuality();
    if (event.eventName === "AgentQualityUpdated") {
      const cooldown = Number(scalar(args.cooldownUntil) ?? 0);
      quality[key] = {
        scoreBps: Number(scalar(args.scoreBps) ?? 5_000),
        outcomeCount: Number(scalar(args.outcomeCount) ?? 0),
        severeFaults: Number(scalar(args.severeFaults) ?? 0),
        cooldownUntil: cooldown > 0 ? new Date(cooldown * 1_000).toISOString() : null,
        banned: scalar(args.banned) === true,
      };
    } else {
      quality[key] = { ...quality[key], scoreBps: 2_500, severeFaults: Math.min(2, quality[key].severeFaults), cooldownUntil: null, banned: false };
    }
    qualities.set(agent, quality);
  }
  return qualities;
}

export function projectChainBusiness(rows: { events: ChainProjectionRow[]; commitments: CommitmentProjectionRow[] }) {
  const positions = new Map<string, StakePosition>();
  const tasks = new Map<string, Task>();
  const rewards = new Map<string, RewardGrant>();
  const economicsByTask = new Map<string, TaskEconomics>();
  const vestings = new Map<string, EconomicsVesting>();
  const commitmentByHash = new Map(rows.commitments.map((item) => [`${item.publisher.toLowerCase()}:${item.specHash.toLowerCase()}`, item]));

  const projectedTask = (taskId: string, publisher: string, positionId: string, specHash: string, state: Task["state"], chainCreatedAt?: string | null): Task | undefined => {
    const commitment = commitmentByHash.get(`${publisher.toLowerCase()}:${specHash.toLowerCase()}`);
    if (!commitment) return undefined;
    const spec = commitment.spec as { title: string; description: string; category: string; executionMode?: "COLLABORATION" | "COMPETITION"; maxExecutors: number; declaredDurationHours: number; criteria: string[]; completionDefinition?: TaskDefinition };
    const createdAt = iso(chainCreatedAt ?? commitment.confirmedAt ?? commitment.createdAt);
    return {
      id: taskId, title: spec.title, description: spec.description, category: spec.category, executionMode: spec.executionMode ?? "COLLABORATION", publisher,
      stakePositionId: positionId, state, maxExecutors: spec.maxExecutors,
      declaredDurationHours: spec.declaredDurationHours, createdAt,
      deadlineAt: new Date(new Date(createdAt).getTime() + (spec.declaredDurationHours + 48) * 3_600_000).toISOString(),
      executorIds: [], testerId: null, testerIds: [], testerSelectionProof: null,
      teamClosed: false, contributionHashes: {}, workRound: 1,
      criteria: spec.criteria.map((description, index) => ({ id: `criterion-${index + 1}`, description })),
      completionDefinition: spec.completionDefinition,
      requiredTesterCapabilities: spec.completionDefinition ? [...new Set(spec.completionDefinition.acceptanceCriteria.map((criterion) => criterion.verificationType))] : undefined,
      submission: null, testResult: null, rewardGrantId: null, maintenanceHealthy: [false, false, false],
    };
  };

  for (const event of rows.events) {
    const args = event.eventArgs ?? {};
    switch (event.eventName) {
      case "PositionCreated":
        positions.set(id(args, "positionId"), { id: id(args, "positionId"), owner: id(args, "owner"), amount: tokens(args.amount), activeTaskId: null, creditExpiresAt: null });
        break;
      case "CreditIssued": {
        const position = positions.get(id(args, "positionId"));
        if (position) position.creditExpiresAt = new Date(Number(args.expiresAt) * 1_000).toISOString();
        break;
      }
      case "CreditConsumed": {
        const position = positions.get(id(args, "positionId"));
        if (position) { position.activeTaskId = id(args, "taskId"); position.creditExpiresAt = null; }
        break;
      }
      case "PositionReleased": {
        const position = positions.get(id(args, "positionId"));
        if (position) position.activeTaskId = null;
        break;
      }
      case "PositionSlashed": {
        const position = positions.get(id(args, "positionId"));
        if (position) position.amount = Math.max(0, position.amount - tokens(args.amount));
        break;
      }
      case "PublicationFeeCharged":
      case "EvaluationFeeCharged": {
        const position = positions.get(id(args, "positionId"));
        if (position) position.amount = Math.max(0, position.amount - tokens(args.amount));
        break;
      }
      case "LifecycleFeeCharged": {
        const position = positions.get(id(args, "positionId"));
        if (position) position.amount = Math.max(0, position.amount - tokens(args.amount));
        break;
      }
      case "TaskSourceFrozen": {
        economicsByTask.set(id(args, "taskId"), {
          sourceId: id(args, "effectiveSourceId"), sourceRecipient: id(args, "recipient"),
          fallbackToDao: scalar(args.fallbackToDao) === true, lifecycleCharges: [], vestings: [],
        });
        break;
      }
      case "VestingCreated": {
        const vestingId = id(args, "vestingId");
        vestings.set(vestingId, {
          id: vestingId, recipient: id(args, "recipient"), amount: tokens(args.amount),
          unlockAt: new Date(Number(scalar(args.unlockAt)) * 1_000).toISOString(), claimed: false,
        });
        break;
      }
      case "VestingClaimed": {
        const vesting = vestings.get(id(args, "vestingId"));
        if (vesting) vesting.claimed = true;
        break;
      }
      case "TaskRewardRouted": {
        const economics = economicsByTask.get(id(args, "taskId"));
        if (!economics) break;
        economics.grossReward = tokens(args.grossReward);
        economics.agentPool = tokens(args.agentPool);
        economics.daoReward = tokens(args.daoAmount);
        economics.sourceReward = tokens(args.sourceAmount);
        for (const key of ["daoVestingId", "sourceVestingId"] as const) {
          const vesting = vestings.get(id(args, key));
          if (vesting) economics.vestings.push(vesting);
        }
        break;
      }
      case "LifecycleChargeRouted": {
        const economics = economicsByTask.get(id(args, "taskId"));
        if (!economics) break;
        const stages = ["EVALUATION", "PUBLICATION", "ACCEPTANCE", "MAINTENANCE"] as const;
        economics.lifecycleCharges.push({
          stage: stages[Number(scalar(args.stage))] ?? "EVALUATION",
          stakeBasis: tokens(args.stakeBasis), amount: tokens(args.amount),
          rewardVault: tokens(args.rewardVaultAmount), burned: tokens(args.burnAmount),
          dao: tokens(args.daoAmount), source: tokens(args.sourceAmount), security: tokens(args.securityAmount),
          transactionHash: event.transactionHash,
        });
        for (const key of ["daoVestingId", "sourceVestingId"] as const) {
          const vesting = vestings.get(id(args, key));
          if (vesting) economics.vestings.push(vesting);
        }
        break;
      }
      case "PositionWithdrawn": {
        const position = positions.get(id(args, "positionId"));
        if (position) { position.amount = 0; position.creditExpiresAt = null; }
        break;
      }
      case "TaskEvaluationRequested": {
        const taskId = id(args, "taskId");
        const task = projectedTask(taskId, id(args, "publisher"), id(args, "positionId"), id(args, "specHash"), "EVALUATING", event.blockTimestamp);
        if (!task) break;
        task.deadlineAt = new Date(Number(args.deadline) * 1_000).toISOString();
        task.evaluation = { status: "ASSIGNING", required: 3, completed: 0, approvals: 0 };
        tasks.set(taskId, task);
        break;
      }
      case "TaskEvaluatorsAssigned": {
        const task = tasks.get(id(args, "taskId"));
        if (task?.evaluation) task.evaluation.status = "IN_PROGRESS";
        break;
      }
      case "TaskEvaluationSubmitted": {
        const task = tasks.get(id(args, "taskId"));
        if (task?.evaluation) {
          task.evaluation.completed += 1;
          if (args.approve) task.evaluation.approvals = (task.evaluation.approvals ?? 0) + 1;
        }
        break;
      }
      case "TaskEvaluationFinalized": {
        const task = tasks.get(id(args, "taskId"));
        if (!task?.evaluation) break;
        if (args.approved) {
          task.evaluation = {
            ...task.evaluation, status: "APPROVED", passed: true, category: task.category,
            difficulty: Number(args.difficultyBps) / 10_000, estimatedHours: Number(args.estimatedHours),
            testability: Number(args.testabilityBps) / 10_000, effectiveReward: tokens(args.requestedReward),
          };
        } else {
          task.state = "REJECTED";
          task.evaluation = { ...task.evaluation, status: "REJECTED", passed: false, reason: "The independent evaluator quorum rejected or did not complete this task." };
        }
        break;
      }
      case "TaskCreated": {
        const taskId = id(args, "taskId");
        const commitment = commitmentByHash.get(`${id(args, "publisher").toLowerCase()}:${id(args, "specHash").toLowerCase()}`);
        if (commitment?.status !== "CONFIRMED") break;
        const existing = tasks.get(taskId);
        if (existing) { existing.state = "OPEN"; existing.publishedAt = event.blockTimestamp ?? undefined; }
        else {
          const task = projectedTask(taskId, id(args, "publisher"), id(args, "positionId"), id(args, "specHash"), "OPEN", event.blockTimestamp);
          if (task) { task.publishedAt = event.blockTimestamp ?? undefined; tasks.set(taskId, task); }
        }
        break;
      }
      case "TaskExecutionModeSet": {
        const task = tasks.get(id(args, "taskId"));
        if (task) task.executionMode = Number(args.mode) === 1 ? "COMPETITION" : "COLLABORATION";
        break;
      }
      case "TaskTesterCapabilitiesSet": {
        const task = tasks.get(id(args, "taskId"));
        const mask = Number(args.requiredCapabilities);
        if (task) task.requiredTesterCapabilities = verificationTypes.filter((capability) => (mask & TESTER_VERIFICATION_CAPABILITY_MASK[capability]) !== 0);
        break;
      }
      case "TaskClaimed": {
        const task = tasks.get(id(args, "taskId"));
        if (task) {
          const executor = id(args, "executor");
          if (!task.executorIds.some((item) => item.toLowerCase() === executor.toLowerCase())) task.executorIds.push(executor);
          task.state = "CLAIMED";
        }
        break;
      }
      case "ExecutorEvicted": {
        const task = tasks.get(id(args, "taskId"));
        if (task) task.executorIds = task.executorIds.filter((item) => item.toLowerCase() !== id(args, "executor").toLowerCase());
        break;
      }
      case "TeamClosed": {
        const task = tasks.get(id(args, "taskId"));
        if (task) task.teamClosed = true;
        break;
      }
      case "ContributionSubmitted": {
        const task = tasks.get(id(args, "taskId"));
        if (task) {
          const round = Number(args.workRound);
          if (task.workRound !== round) task.contributionHashes = {};
          task.workRound = round;
          task.contributionHashes ??= {};
          task.contributionHashes[id(args, "executor").toLowerCase()] = id(args, "contributionHash");
        }
        break;
      }
      case "WorkSubmitted": {
        const task = tasks.get(id(args, "taskId"));
        if (task) { task.state = "SUBMITTED"; task.submission = { artifactUrl: `chain://${event.transactionHash}`, artifactHash: id(args, "artifactHash"), summary: "Artifact commitment confirmed on BSC", submittedAt: event.blockTimestamp ?? task.createdAt }; }
        break;
      }
      case "CompetitionReady": {
        const task = tasks.get(id(args, "taskId"));
        if (task) task.state = "SUBMITTED";
        break;
      }
      case "TesterAssigned": {
        const task = tasks.get(id(args, "taskId"));
        if (task) { task.state = "TESTING"; task.testerId = id(args, "tester"); task.testerSelectionProof = id(args, "selectionProof"); }
        break;
      }
      case "TesterPanelAssigned": {
        const task = tasks.get(id(args, "taskId"));
        if (task) {
          task.state = "TESTING";
          task.testerIds = [id(args, "tester0"), id(args, "tester1"), id(args, "tester2")];
          task.testerId = task.testerIds[0];
          task.testerSelectionProof = id(args, "selectionProof");
        }
        break;
      }
      case "ExecutorQualityMultipliersFrozen": {
        const task = tasks.get(id(args, "taskId"));
        if (task && Array.isArray(args.multipliersBps)) task.executorQualityMultipliersBps = args.multipliersBps.map(Number);
        break;
      }
      case "TestSubmitted": {
        const task = tasks.get(id(args, "taskId"));
        if (task) {
          const maintenanceRound = Boolean(task.maintenanceRepairCheckpoint);
          task.state = args.passed ? (task.maintenanceRepairCheckpoint ? (task.maintenanceRepairCheckpoint === 3 ? "COMPLETED" : "MAINTENANCE") : "USER_REVIEW") : "CLAIMED";
          if (task.state === "COMPLETED") task.completedAt = event.blockTimestamp ?? undefined;
          if (args.passed) task.maintenanceRepairCheckpoint = null;
          if (!args.passed && !maintenanceRound) { task.workRound = (task.workRound ?? 1) + 1; task.contributionHashes = {}; }
        }
        break;
      }
      case "CompetitionResultSubmitted": {
        const task = tasks.get(id(args, "taskId"));
        if (task) {
          task.state = args.passed ? (task.maintenanceRepairCheckpoint ? (task.maintenanceRepairCheckpoint === 3 ? "COMPLETED" : "MAINTENANCE") : "USER_REVIEW") : "CLAIMED";
          if (task.state === "COMPLETED") task.completedAt = event.blockTimestamp ?? undefined;
          if (args.passed) task.maintenanceRepairCheckpoint = null;
          if (args.passed) task.submission = { artifactUrl: `chain://${event.transactionHash}`, artifactHash: id(args, "artifactHash"), summary: `Competition winner ${id(args, "winner")}`, submittedAt: event.blockTimestamp ?? task.createdAt };
          else { task.workRound = (task.workRound ?? 1) + 1; task.contributionHashes = {}; }
        }
        break;
      }
      case "UserReviewed": {
        const task = tasks.get(id(args, "taskId"));
        if (task) task.state = args.accepted ? "MAINTENANCE" : "DISPUTED";
        break;
      }
      case "RejectionResolved": {
        const task = tasks.get(id(args, "taskId"));
        if (task) task.state = args.executorWins ? "MAINTENANCE" : "REJECTED";
        break;
      }
      case "MaintenanceValidated": {
        const task = tasks.get(id(args, "taskId"));
        const checkpoint = Number(args.checkpoint);
        if (task && args.passed && checkpoint >= 1 && checkpoint <= 3) { task.maintenanceHealthy[checkpoint - 1] = true; if (checkpoint === 3) { task.state = "COMPLETED"; task.completedAt = event.blockTimestamp ?? undefined; } }
        break;
      }
      case "MaintenancePanelRequested": {
        const task = tasks.get(id(args, "taskId"));
        if (task) {
          task.state = "TESTING";
          task.maintenanceRepairCheckpoint = Number(args.checkpoint);
        }
        break;
      }
      case "MaintenanceRepairRequested": {
        const task = tasks.get(id(args, "taskId"));
        if (task) {
          task.state = "CLAIMED";
          task.workRound = Number(args.workRound);
          task.contributionHashes = {};
          task.submission = null;
          task.testerId = null;
          task.testerIds = [];
          task.testerSelectionProof = null;
          task.maintenanceRepairCheckpoint = Number(args.checkpoint);
        }
        break;
      }
      case "FutureParticipantsUpdated": {
        const task = tasks.get(id(args, "taskId"));
        const executors = Array.isArray(args.executors) ? args.executors.map(String) : [];
        const weightsBps = Array.isArray(args.executorWeightsBps) ? args.executorWeightsBps.map(Number) : [];
        if (task && executors.length > 0 && executors.length === weightsBps.length) {
          task.maintenanceRewardDistribution = {
            fromCheckpoint: Number(args.fromCheckpoint), executors, weightsBps,
            tester: id(args, "tester"),
            proof: id(args, "executorWeightsHash"),
          };
        }
        break;
      }
      case "GrantCreated": {
        const taskId = id(args, "taskId");
        const task = tasks.get(taskId);
        if (!task) break;
        const total = economicsByTask.get(taskId)?.agentPool ?? tokens(args.grossReward);
        const grantId = `chain-grant-${taskId}`;
        const shares = [0.4, 0.2, 0.2, 0.2];
        const days = [0, 7, 30, 90];
        const startedAt = event.blockTimestamp ?? task.createdAt;
        rewards.set(grantId, {
          id: grantId, taskId, epochId: "chain", total, difficulty: 1,
          collaborationMultiplier: Number(args.multiplierBps) / 10_000, issuanceProof: id(args, "issuanceProof"),
          tranches: shares.map((share, index) => ({ id: String(index), label: index === 0 ? "Delivery" : `Day ${days[index]}`, dueAt: plusDays(startedAt, days[index]), amount: total * share, status: index === 0 ? "CLAIMABLE" : "LOCKED" })),
        });
        task.rewardGrantId = grantId;
        break;
      }
      case "CheckpointApproved": {
        const grant = rewards.get(`chain-grant-${id(args, "taskId")}`);
        const checkpoint = Number(args.checkpoint);
        if (grant?.tranches[checkpoint]) grant.tranches[checkpoint].status = "CLAIMABLE";
        break;
      }
      case "RewardClaimed": {
        const grant = rewards.get(`chain-grant-${id(args, "taskId")}`);
        const checkpoint = Number(args.checkpoint);
        if (grant?.tranches[checkpoint]) grant.tranches[checkpoint].status = "CLAIMED";
        break;
      }
    }
  }
  for (const [taskId, economics] of economicsByTask) {
    const task = tasks.get(taskId);
    if (task) task.economics = economics;
  }
  const economics: ProtocolEconomicsSummary = {
    grossTaskRewards: 0, agentPool: 0, daoVested: 0, sourceVested: 0,
    lifecycleConsumed: 0, rewardVaultRecycled: 0, burned: 0, securityReserved: 0,
    netDemand30d: { status: "UNAVAILABLE", reason: "External buyback execution and treasury-sale receipts are not yet indexed." },
    netDemand90d: { status: "UNAVAILABLE", reason: "External buyback execution and treasury-sale receipts are not yet indexed." },
  };
  for (const task of economicsByTask.values()) {
    economics.grossTaskRewards += task.grossReward ?? 0;
    economics.agentPool += task.agentPool ?? 0;
    economics.daoVested += task.daoReward ?? 0;
    economics.sourceVested += task.sourceReward ?? 0;
    for (const charge of task.lifecycleCharges) {
      economics.lifecycleConsumed += charge.amount;
      economics.rewardVaultRecycled += charge.rewardVault;
      economics.burned += charge.burned;
      economics.daoVested += charge.dao;
      economics.sourceVested += charge.source;
      economics.securityReserved += charge.security;
    }
  }
  return { positions: [...positions.values()], tasks: [...tasks.values()], rewards: [...rewards.values()], economics };
}
