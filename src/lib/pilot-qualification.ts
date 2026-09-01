import type { BusinessAdoption, ExecutionMode, TaskState, TestResult } from "./types";
import type { PilotSignoffRole, VerifiedPilotSignoffBundle } from "./pilot-signoff";

export interface PilotQualificationTask {
  id: string;
  publisher: string;
  state: TaskState;
  executionMode: ExecutionMode;
  executorIds: string[];
  testerId: string | null;
  testerIds?: string[];
  testResult: TestResult | null;
  businessAdoption?: BusinessAdoption;
}

export interface PilotQualificationEvent {
  eventName: string;
  eventArgs?: Record<string, unknown>;
}

export interface ValidPilotAdoption {
  taskId: string;
  publisher: string;
  artifactHash: string;
  reportHash: string;
}

const normalized = (value: string) => value.toLowerCase();
const eventId = (event: PilotQualificationEvent) => String(event.eventArgs?.taskId ?? "");
const passed = (value: unknown) => value === true || value === "true";
const token = (amount: number) => BigInt(amount) * (BigInt(10) ** BigInt(18));
const asBigInt = (value: unknown) => {
  try { return BigInt(String(value)); } catch { return BigInt(-1); }
};
const asAddresses = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && /^0x[0-9a-fA-F]{40}$/.test(item)).map(normalized)
  : [];

function completeValidatorPanels(events: PilotQualificationEvent[], taskIds: Set<string>) {
  const validators = new Set<string>();
  const completeTasks = new Set<string>();
  events.forEach((started, startedIndex) => {
    if (started.eventName !== "PanelStarted" || !taskIds.has(eventId(started))) return;
    const testers = asAddresses(started.eventArgs?.testers);
    const masks = Array.isArray(started.eventArgs?.criterionMasks) ? started.eventArgs.criterionMasks.map(Number) : [];
    const workRound = Number(started.eventArgs?.workRound);
    const epoch = Number(started.eventArgs?.epoch);
    if (testers.length !== 3 || new Set(testers).size !== 3 || masks.length !== 3 || !masks.every((mask) => Number.isInteger(mask) && mask > 0)) return;
    const requiredMask = masks.reduce((mask, value) => mask | value, 0);
    for (let bit = 0; bit < 16; bit += 1) {
      if ((requiredMask & (1 << bit)) !== 0 && masks.filter((mask) => (mask & (1 << bit)) !== 0).length !== 2) return;
    }
    const matching = events.map((event, index) => ({ event, index })).filter(({ event }) =>
      eventId(event) === eventId(started)
      && Number(event.eventArgs?.workRound) === workRound
      && Number(event.eventArgs?.epoch) === epoch);
    const commits = matching.filter(({ event }) => event.eventName === "ShardCommitted");
    const reveals = matching.filter(({ event }) => event.eventName === "ShardRevealed");
    const validStage = (rows: typeof matching, committed: boolean) => rows.length === 3
      && new Set(rows.map(({ event }) => normalized(String(event.eventArgs?.tester)))).size === 3
      && new Set(rows.map(({ event }) => Number(event.eventArgs?.shard))).size === 3
      && rows.every(({ event }) => {
        const shard = Number(event.eventArgs?.shard);
        return shard >= 0 && shard < 3 && normalized(String(event.eventArgs?.tester)) === testers[shard];
      })
      && (!committed || [...rows.map(({ event }) => Number(event.eventArgs?.commitOrder))].sort((a, b) => a - b).join(",") === "0,1,2");
    if (!validStage(commits, true) || !validStage(reveals, false)) return;
    if (Math.min(...commits.map(({ index }) => index)) > startedIndex
      && Math.max(...commits.map(({ index }) => index)) < Math.min(...reveals.map(({ index }) => index))) {
      completeTasks.add(eventId(started));
      testers.forEach((tester) => validators.add(tester));
    }
  });
  return { validators, completeTasks };
}

function courtEvidence(events: PilotQualificationEvent[], taskEvents: PilotQualificationEvent[], validators: Set<string>) {
  const funded = new Set(events.filter((event) => event.eventName === "ArbitrationStakeDeposited"
    && asBigInt(event.eventArgs?.totalStake) >= token(500))
    .map((event) => normalized(String(event.eventArgs?.agent))));
  const votes = taskEvents.filter((event) => event.eventName === "VerificationChallengeVote");
  const arbitrators = new Set(votes.map((event) => normalized(String(event.eventArgs?.arbitrator))).filter((address) => funded.has(address)));
  const opened = new Map(taskEvents.filter((event) => event.eventName === "VerificationChallengeOpened")
    .map((event) => [String(event.eventArgs?.caseId).toLowerCase(), event]));
  const resolutions = taskEvents.filter((event) => event.eventName === "VerificationChallengeResolved");
  const hasQuorum = (resolution: PilotQualificationEvent) => {
    const caseId = String(resolution.eventArgs?.caseId).toLowerCase();
    const resolutionHash = String(resolution.eventArgs?.resolutionHash).toLowerCase();
    const upheld = passed(resolution.eventArgs?.upheld);
    return new Set(votes.filter((vote) => String(vote.eventArgs?.caseId).toLowerCase() === caseId
      && String(vote.eventArgs?.resolutionHash).toLowerCase() === resolutionHash
      && passed(vote.eventArgs?.upheld) === upheld
      && funded.has(normalized(String(vote.eventArgs?.arbitrator))))
      .map((vote) => normalized(String(vote.eventArgs?.arbitrator)))).size >= 2;
  };
  const validOpened = (resolution: PilotQualificationEvent) => {
    const event = opened.get(String(resolution.eventArgs?.caseId).toLowerCase());
    return event
      && asBigInt(event.eventArgs?.challengerStakeSnapshot) >= token(500)
      && validators.has(normalized(String(event.eventArgs?.validator)));
  };
  const correctChallenge = resolutions.some((resolution) => passed(resolution.eventArgs?.upheld)
    && hasQuorum(resolution) && validOpened(resolution)
    && asBigInt(resolution.eventArgs?.validatorSlash) === token(100)
    && asBigInt(resolution.eventArgs?.challengerReward) === token(60)
    && Number(resolution.eventArgs?.challengerPenaltyBps) === 0);
  const falseByChallenger = new Map<string, PilotQualificationEvent[]>();
  resolutions.filter((resolution) => !passed(resolution.eventArgs?.upheld)).forEach((resolution) => {
    const challenge = opened.get(String(resolution.eventArgs?.caseId).toLowerCase());
    if (!challenge) return;
    const challenger = normalized(String(challenge.eventArgs?.challenger));
    const rows = falseByChallenger.get(challenger) ?? [];
    rows.push(resolution);
    falseByChallenger.set(challenger, rows);
  });
  const falseChallengeSequence = [...falseByChallenger.values()].some((rows) => [500, 1_500, 3_000].every((penaltyBps, index) => {
    const resolution = rows[index];
    const challenge = resolution ? opened.get(String(resolution.eventArgs?.caseId).toLowerCase()) : undefined;
    const expectedSlash = challenge
      ? (asBigInt(challenge.eventArgs?.challengerStakeSnapshot) * BigInt(penaltyBps)) / BigInt(10_000)
      : BigInt(-1);
    return resolution && hasQuorum(resolution) && validOpened(resolution)
      && Number(resolution.eventArgs?.challengerPenaltyBps) === penaltyBps
      && Number(resolution.eventArgs?.challengerFalseChallengeCount) === index + 1
      && asBigInt(resolution.eventArgs?.challengerSlash) === expectedSlash
      && asBigInt(resolution.eventArgs?.validatorSlash) === BigInt(0)
      && asBigInt(resolution.eventArgs?.challengerReward) === BigInt(0);
  }));
  const challengers = new Set([...opened.values()].map((event) => normalized(String(event.eventArgs?.challenger))));
  const appealOpened = new Map(events.filter((event) => event.eventName === "RehabilitationAppealOpened")
    .map((event) => [String(event.eventArgs?.caseId).toLowerCase(), event]));
  const appealVotes = events.filter((event) => event.eventName === "RehabilitationAppealVote");
  appealVotes.map((event) => normalized(String(event.eventArgs?.arbitrator)))
    .filter((address) => funded.has(address)).forEach((address) => arbitrators.add(address));
  const validAppealOpen = (caseId: string) => {
    const event = appealOpened.get(caseId);
    return event && challengers.has(normalized(String(event.eventArgs?.appellant)))
      && asBigInt(event.eventArgs?.stakeSnapshot) >= token(500);
  };
  const appealQuorum = (event: PilotQualificationEvent) => {
    const caseId = String(event.eventArgs?.caseId).toLowerCase();
    const resolutionHash = String(event.eventArgs?.resolutionHash).toLowerCase();
    const upheld = passed(event.eventArgs?.upheld);
    return new Set(appealVotes.filter((vote) => String(vote.eventArgs?.caseId).toLowerCase() === caseId
      && String(vote.eventArgs?.resolutionHash).toLowerCase() === resolutionHash
      && passed(vote.eventArgs?.upheld) === upheld)
      .map((vote) => normalized(String(vote.eventArgs?.arbitrator))).filter((address) => funded.has(address))).size >= 2;
  };
  const appealResolved = events.filter((event) => event.eventName === "RehabilitationAppealResolved");
  const upheldAppeal = appealResolved.some((event) => passed(event.eventArgs?.upheld) && appealQuorum(event)
    && validAppealOpen(String(event.eventArgs?.caseId).toLowerCase()));
  const rejectedAppeal = appealResolved.some((event) => !passed(event.eventArgs?.upheld) && appealQuorum(event)
    && validAppealOpen(String(event.eventArgs?.caseId).toLowerCase()) && asBigInt(event.eventArgs?.appellantSlash) > BigInt(0));
  const expiredAppeal = events.some((event) => event.eventName === "RehabilitationAppealExpired"
    && validAppealOpen(String(event.eventArgs?.caseId).toLowerCase()));
  const appellants = new Set([...appealOpened.values()].map((event) => normalized(String(event.eventArgs?.appellant))));
  return {
    arbitrators, challengers, appellants, correctChallenge, falseChallengeSequence,
    rehabilitationLifecycle: upheldAppeal && rejectedAppeal && expiredAppeal,
  };
}

function coversSubjects(signoff: VerifiedPilotSignoffBundle | undefined, role: PilotSignoffRole, subjects: Set<string>) {
  return signoff?.attestations.some((attestation) => {
    if (attestation.role !== role) return false;
    const signedSubjects = new Set(attestation.subjectAddresses.map((address) => normalized(address)));
    return [...subjects].every((subject) => signedSubjects.has(subject));
  }) ?? false;
}

export function assessPilotQualification(input: {
  tasks: PilotQualificationTask[];
  events: PilotQualificationEvent[];
  validAdoptions: ValidPilotAdoption[];
  invalidAdoptionRows?: number;
  signoff?: VerifiedPilotSignoffBundle;
  deploymentManifestSha256?: string;
  signoffStatus?: "missing" | "invalid" | "verified";
}) {
  const blockers: string[] = [];
  const validAdoptions = new Map(input.validAdoptions.map((adoption) => [`${adoption.taskId}:${normalized(adoption.artifactHash)}`, adoption]));
  const signedTaskIds = input.signoff ? new Set(input.signoff.taskIds) : undefined;
  const qualificationTasks = signedTaskIds ? input.tasks.filter((task) => signedTaskIds.has(task.id)) : input.tasks;
  const qualificationEvents = signedTaskIds ? input.events.filter((event) => signedTaskIds.has(eventId(event))) : input.events;
  const adoptedTasks = qualificationTasks.filter((task) => {
    const adoption = task.businessAdoption;
    const verifiedAdoption = adoption ? validAdoptions.get(`${task.id}:${normalized(adoption.artifactHash)}`) : undefined;
    return adoption && ["MAINTENANCE", "COMPLETED"].includes(task.state) && task.testResult?.passed
      && verifiedAdoption
      && normalized(adoption.publisher) === normalized(task.publisher)
      && normalized(verifiedAdoption.publisher) === normalized(task.publisher)
      && normalized(verifiedAdoption.reportHash) === normalized(adoption.reportHash);
  });
  const publisherWallets = new Set(adoptedTasks.map((task) => normalized(task.publisher)));
  const adoptedTaskIds = new Set(adoptedTasks.map((task) => task.id));
  const executorWallets = new Set(adoptedTasks.flatMap((task) => task.executorIds).map(normalized));
  const panels = completeValidatorPanels(qualificationEvents, adoptedTaskIds);
  const evaluatorWallets = new Set(qualificationEvents.filter((event) => event.eventName === "TaskEvaluatorsAssigned")
    .flatMap((event) => [event.eventArgs?.evaluator0, event.eventArgs?.evaluator1, event.eventArgs?.evaluator2])
    .filter((address): address is string => typeof address === "string").map(normalized));
  const court = courtEvidence(input.events, qualificationEvents, panels.validators);
  const courtActors = new Set([...court.challengers, ...court.appellants]);
  const agentWallets = new Set([...executorWallets, ...panels.validators, ...evaluatorWallets, ...court.arbitrators, ...courtActors]);
  const roleOverlap = [...publisherWallets].filter((address) => agentWallets.has(address));
  const roleSets = [executorWallets, panels.validators, evaluatorWallets, court.arbitrators, courtActors];
  const agentRoleOverlap = [...new Set(roleSets.flatMap((set) => [...set]))].filter((address) => roleSets.filter((set) => set.has(address)).length > 1);

  if ((input.invalidAdoptionRows ?? 0) > 0) blockers.push("PILOT_ADOPTION_SIGNATURE_INVALID");
  if (adoptedTasks.length < 3) blockers.push("PILOT_REAL_ADOPTED_TASKS_3_REQUIRED");
  if (publisherWallets.size < 3) blockers.push("PILOT_DISTINCT_PUBLISHERS_3_REQUIRED");
  if (agentWallets.size < 3) blockers.push("PILOT_DISTINCT_AGENT_WALLETS_3_REQUIRED");
  if (roleOverlap.length > 0) blockers.push("PILOT_PUBLISHER_AGENT_ROLE_OVERLAP");
  if (panels.completeTasks.size !== adoptedTaskIds.size) blockers.push("PILOT_COMPLETE_SHARDED_VALIDATION_REQUIRED");
  if (panels.validators.size < 3) blockers.push("PILOT_DISTINCT_VALIDATORS_3_REQUIRED");
  if (evaluatorWallets.size < 3) blockers.push("PILOT_DISTINCT_EVALUATORS_3_REQUIRED");
  if (court.arbitrators.size < 3) blockers.push("PILOT_STAKED_ARBITRATORS_3_REQUIRED");
  if (agentRoleOverlap.length > 0) blockers.push("PILOT_AGENT_ROLE_OVERLAP");
  if (!court.correctChallenge) blockers.push("PILOT_CORRECT_CHALLENGE_ACCOUNTING_REQUIRED");
  if (!court.falseChallengeSequence) blockers.push("PILOT_FALSE_CHALLENGE_5_15_30_REQUIRED");
  if (!court.rehabilitationLifecycle) blockers.push("PILOT_REHABILITATION_APPEAL_LIFECYCLE_REQUIRED");

  const modes = new Set(adoptedTasks.map((task) => task.executionMode));
  if (!modes.has("COLLABORATION")) blockers.push("PILOT_COLLABORATION_ADOPTION_REQUIRED");
  if (!modes.has("COMPETITION")) blockers.push("PILOT_COMPETITION_ADOPTION_REQUIRED");

  if (!qualificationEvents.some((event) => event.eventName === "RejectionResolved")) blockers.push("PILOT_DISPUTE_RESOLUTION_REQUIRED");
  const maintenanceByTask = new Map<string, Set<number>>();
  for (const event of qualificationEvents) {
    if (event.eventName !== "MaintenanceValidated" || !passed(event.eventArgs?.passed)) continue;
    const checkpoints = maintenanceByTask.get(eventId(event)) ?? new Set<number>();
    checkpoints.add(Number(event.eventArgs?.checkpoint));
    maintenanceByTask.set(eventId(event), checkpoints);
  }
  if (![...maintenanceByTask.values()].some((checkpoints) => [1, 2, 3].every((checkpoint) => checkpoints.has(checkpoint)))) {
    blockers.push("PILOT_MAINTENANCE_7_30_90_REQUIRED");
  }
  if (!qualificationEvents.some((event) => event.eventName === "GrantCreated" && Number(event.eventArgs?.multiplierBps) < 10_000)) {
    blockers.push("PILOT_REPEAT_COLLABORATION_DECAY_REQUIRED");
  }

  const technicalBlockers = [...blockers];
  const signoffRoles = new Set(input.signoff?.attestations.map((attestation) => attestation.role) ?? []);
  if (input.signoffStatus === "invalid") blockers.push("PILOT_SIGNOFF_FILE_INVALID");
  else if (!input.signoff || input.signoffStatus === "missing") blockers.push("PILOT_SIGNOFF_FILE_MISSING");
  if (input.signoff && input.deploymentManifestSha256
    && normalized(input.signoff.deploymentManifestSha256) !== normalized(input.deploymentManifestSha256)) {
    blockers.push("PILOT_SIGNOFF_DEPLOYMENT_HASH_MISMATCH");
  }
  if (input.signoff) {
    const knownTaskIds = new Set(input.tasks.map((task) => task.id));
    if (input.signoff.taskIds.some((taskId) => !knownTaskIds.has(taskId))) blockers.push("PILOT_SIGNOFF_TASK_SET_UNKNOWN");
    const latestAdoptionAttestation = Math.max(...adoptedTasks.map((task) => new Date(task.businessAdoption!.attestedAt).getTime()));
    if (Number.isFinite(latestAdoptionAttestation)
      && input.signoff.attestations.some((attestation) => new Date(attestation.signedAt).getTime() < latestAdoptionAttestation)) {
      blockers.push("PILOT_SIGNOFF_PREDATES_ADOPTION");
    }
  }
  if (!coversSubjects(input.signoff, "PUBLISHER_INDEPENDENCE_REVIEW", publisherWallets)) blockers.push("PILOT_PUBLISHER_INDEPENDENCE_REVIEW_REQUIRED");
  if (!coversSubjects(input.signoff, "AGENT_INDEPENDENCE_REVIEW", agentWallets)) blockers.push("PILOT_AGENT_INDEPENDENCE_REVIEW_REQUIRED");
  for (const role of ["SUPPORT_OWNER", "DISPUTE_OWNER", "INCIDENT_RESPONSE_OWNER", "ROLLBACK_OWNER"] as const) {
    if (!signoffRoles.has(role)) blockers.push(`PILOT_${role}_SIGNOFF_REQUIRED`);
  }

  return {
    technicalEvidenceReady: technicalBlockers.length === 0,
    launchEvidenceReady: blockers.length === 0,
    observed: {
      adoptedTasks: adoptedTasks.length,
      publisherWallets: publisherWallets.size,
      agentWallets: agentWallets.size,
      publisherAgentOverlaps: roleOverlap.length,
      agentRoleOverlaps: agentRoleOverlap.length,
      validatorWallets: panels.validators.size,
      evaluatorWallets: evaluatorWallets.size,
      stakedArbitratorWallets: court.arbitrators.size,
      completeShardedValidationTasks: panels.completeTasks.size,
      correctChallengeAccountingObserved: court.correctChallenge,
      falseChallengePenaltySequenceObserved: court.falseChallengeSequence,
      rehabilitationAppealLifecycleObserved: court.rehabilitationLifecycle,
      collaborationAdoptions: adoptedTasks.filter((task) => task.executionMode === "COLLABORATION").length,
      competitionAdoptions: adoptedTasks.filter((task) => task.executionMode === "COMPETITION").length,
      disputeResolved: qualificationEvents.some((event) => event.eventName === "RejectionResolved"),
      maintenanceLifecycleComplete: [...maintenanceByTask.values()].some((checkpoints) => [1, 2, 3].every((checkpoint) => checkpoints.has(checkpoint))),
      repeatedCombinationDecayObserved: qualificationEvents.some((event) => event.eventName === "GrantCreated" && Number(event.eventArgs?.multiplierBps) < 10_000),
      verifiedSignoffs: input.signoff?.attestations.length ?? 0,
    },
    evidence: {
      taskIds: adoptedTasks.map((task) => task.id),
      signedTaskIds: input.signoff?.taskIds ?? null,
      taskSetHash: input.signoff?.taskSetHash ?? null,
      publisherWallets: [...publisherWallets].sort(),
      agentWallets: [...agentWallets].sort(),
      validatorWallets: [...panels.validators].sort(),
      evaluatorWallets: [...evaluatorWallets].sort(),
      arbitratorWallets: [...court.arbitrators].sort(),
      pilotId: input.signoff?.pilotId ?? null,
      deploymentManifestSha256: input.deploymentManifestSha256 ?? null,
    },
    blockers,
    limitations: [
      "DISTINCT_ADDRESSES_ALONE_DO_NOT_PROVE_INDEPENDENT_CONTROL",
      "SIGNED_REVIEWS_ATTEST_TO_OFF_PLATFORM_IDENTITY_BUT_DO_NOT_PROVE_IT_ON_CHAIN",
    ],
  };
}
