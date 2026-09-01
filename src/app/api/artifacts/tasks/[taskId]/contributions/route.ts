import { NextRequest, NextResponse } from "next/server";
import { keccak256, stringToHex } from "viem";
import { openArtifactKey } from "@/lib/artifact-crypto";
import { createArtifactDownload } from "@/lib/artifacts";
import { apiError } from "@/lib/http";
import { assertTeamArtifactAccess, encryptedArtifactAccess } from "@/lib/artifact-access";
import { isProductionMode } from "@/lib/env";
import { authenticateAgent, protocolSnapshot } from "@/lib/service";
import { hiddenTestForTask, readyArtifactsForTask } from "@/lib/store-postgres";
import { readJsonBody } from "@/lib/request-body";
import { roleCanLease } from "@/lib/agent-roles";
import { agentIdBodySchema } from "@/lib/agent-delivery-schema";
import { onchainTaskIdPathParameterSchema } from "@/lib/path-parameters";

export async function POST(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  try {
    const taskId = onchainTaskIdPathParameterSchema.parse((await context.params).taskId);
    const body = agentIdBodySchema.parse(await readJsonBody(request));
    const agent = await authenticateAgent(body.agentId, request.headers.get("x-agent-key"));
    const snapshot = await protocolSnapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("TEAM_ARTIFACT_ACCESS_DENIED");
    const access = assertTeamArtifactAccess({ task, owner: agent.owner });
    const isAssignedTester = access.isTester;
    const requiredScope = isAssignedTester ? "tests:submit" : "tasks:submit";
    if (!roleCanLease(agent.role, isAssignedTester ? "TESTER" : "EXECUTOR")) throw new Error("AGENT_ROLE_DENIED");
    if (isProductionMode() && !(agent.scopes ?? []).includes(requiredScope)) throw new Error("AGENT_SCOPE_DENIED");
    const commitments = task.contributionHashes ?? {};
    const artifacts = await readyArtifactsForTask(taskId);
    const deliveries = [];
    const deliveredOwners = new Set<string>();
    for (const artifact of artifacts) {
      const contributor = snapshot.agents.find((candidate) => candidate.id === artifact.agentId);
      if (!contributor || !task.executorIds.some((owner) => owner.toLowerCase() === contributor.owner.toLowerCase())) continue;
      if (deliveredOwners.has(contributor.owner.toLowerCase())) continue;
      const commitment = keccak256(stringToHex(`sha256:${artifact.plaintextSha256}`));
      if (commitments[contributor.owner.toLowerCase()]?.toLowerCase() !== commitment.toLowerCase()) continue;
      deliveries.push({
        slot: task.executorIds.findIndex((owner) => owner.toLowerCase() === contributor.owner.toLowerCase()) + 1,
        contributor: contributor.owner,
        ...encryptedArtifactAccess(artifact, { decryptionKey: openArtifactKey(artifact), downloadUrl: await createArtifactDownload(artifact.objectKey) }),
      });
      deliveredOwners.add(contributor.owner.toLowerCase());
    }
    const hiddenTest = task.executionMode === "COMPETITION" && isAssignedTester ? await hiddenTestForTask(taskId) : undefined;
    return NextResponse.json({
      taskId,
      workRound: task.workRound ?? 1,
      contributions: deliveries,
      ...(hiddenTest ? { hiddenTest: encryptedArtifactAccess(hiddenTest, { decryptionKey: openArtifactKey(hiddenTest), downloadUrl: await createArtifactDownload(hiddenTest.objectKey) }) } : {}),
    });
  } catch (error) { return apiError(error); }
}
