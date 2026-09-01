import { collaborationPlanBlockers, taskDefinitionSchema, type TaskDefinition } from "./task-definition";

export function collaborationWorkPackage(definitionRaw: unknown, maxExecutors: number, slot: number) {
  const definition = taskDefinitionSchema.parse(definitionRaw);
  const blockers = collaborationPlanBlockers(definition, "COLLABORATION", maxExecutors);
  if (blockers.length) throw new Error(blockers[0]);
  if (!Number.isInteger(slot) || slot < 1 || slot > maxExecutors) throw new Error("COLLABORATION_SLOT_INVALID");
  const workPackage = definition.collaborationPlan?.workPackages[slot - 1];
  if (!workPackage || workPackage.slot !== slot) throw new Error("COLLABORATION_WORK_PACKAGE_NOT_FOUND");
  return { definition, plan: definition.collaborationPlan!, workPackage };
}

export function collaborationExecutionPrompt(definitionRaw: unknown, maxExecutors: number, slot: number) {
  const { plan, workPackage } = collaborationWorkPackage(definitionRaw, maxExecutors, slot);
  return [
    `You own frozen collaboration slot ${slot} of ${maxExecutors}: ${workPackage.title}.`,
    `Objective: ${workPackage.objective}`,
    `Required deliverables: ${workPackage.deliverables.join(" | ")}`,
    `Acceptance-criterion ownership: ${workPackage.criterionIds.join(", ")}.`,
    `Assembly dependencies: ${workPackage.dependsOn.length ? workPackage.dependsOn.join(", ") : "none; this work package can be produced in parallel"}.`,
    `Shared interfaces: ${plan.sharedInterfaces.join(" | ")}`,
    "Produce only this independently runnable contribution and its handoff manifest. Do not absorb another slot's ownership or change a shared interface without documenting the conflict for the lead.",
  ].join("\n");
}

export function collaborationAssemblyPrompt(definition: TaskDefinition, contributions: Array<{ slot: number; contributor: string; manifest: unknown }>) {
  const parsed = taskDefinitionSchema.parse(definition);
  const plan = parsed.collaborationPlan;
  if (!plan) throw new Error("COLLABORATION_PLAN_MISSING");
  const received = new Set(contributions.map((item) => item.slot));
  if (received.size !== contributions.length) throw new Error("COLLABORATION_CONTRIBUTION_SLOT_DUPLICATE");
  for (const slot of received) if (slot < 1 || slot > plan.workPackages.length) throw new Error("COLLABORATION_CONTRIBUTION_SLOT_INVALID");
  const unfilled = plan.workPackages.filter((workPackage) => !received.has(workPackage.slot));
  return [
    `Frozen assembly strategy: ${plan.assemblyStrategy}`,
    ...(unfilled.length ? [`Frozen underfilled-team strategy: ${plan.underfilledStrategy}`, `Lead-owned unfilled work packages: ${unfilled.map((item) => `${item.slot}:${item.title}`).join(" | ")}`] : []),
    `Shared interfaces: ${plan.sharedInterfaces.join(" | ")}`,
    `Mandatory integration checks: ${plan.integrationChecks.join(" | ")}`,
    "Committed slot contributions:",
    ...contributions.sort((a, b) => a.slot - b.slot).map((item) => JSON.stringify({ slot: item.slot, contributor: item.contributor, workPackage: plan.workPackages[item.slot - 1], manifest: item.manifest })),
  ].join("\n");
}
