import type { BusinessAdoption, ExecutionMode, TaskState, TestResult } from "./types";
import type { PilotSignoffRole, VerifiedPilotSignoffBundle } from "./pilot-signoff";

export interface PilotQualificationTask {
  id: string;
  publisher: string;
  state: TaskState;
  executionMode: ExecutionMode;
  executorIds: string[];
  testerId: string | null;
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
  const agentWallets = new Set(adoptedTasks.flatMap((task) => [...task.executorIds, ...(task.testerId ? [task.testerId] : [])]).map(normalized));
  const roleOverlap = [...publisherWallets].filter((address) => agentWallets.has(address));

  if ((input.invalidAdoptionRows ?? 0) > 0) blockers.push("PILOT_ADOPTION_SIGNATURE_INVALID");
  if (adoptedTasks.length < 3) blockers.push("PILOT_REAL_ADOPTED_TASKS_3_REQUIRED");
  if (publisherWallets.size < 3) blockers.push("PILOT_DISTINCT_PUBLISHERS_3_REQUIRED");
  if (agentWallets.size < 3) blockers.push("PILOT_DISTINCT_AGENT_WALLETS_3_REQUIRED");
  if (roleOverlap.length > 0) blockers.push("PILOT_PUBLISHER_AGENT_ROLE_OVERLAP");

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
