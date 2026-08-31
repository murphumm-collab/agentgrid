import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertPublisherArtifactRelease } from "@/lib/artifact-access";
import {
  assertBusinessAdoptionEligibility,
  businessAdoptionReportSchema,
  verifyBusinessAdoptionSignature,
} from "@/lib/business-adoption";
import { readWalletSession, requirePublisherRequest } from "@/lib/auth";
import { runtimeConfig } from "@/lib/env";
import { apiError } from "@/lib/http";
import { readJsonBody } from "@/lib/request-body";
import { audit, enforceRateLimit, requestId } from "@/lib/security";
import { protocolSnapshot } from "@/lib/service";
import {
  businessAdoptionForTask,
  latestPublisherArtifactRelease,
  publisherArtifactReleaseById,
  storeBusinessAdoption,
} from "@/lib/store-postgres";

const submissionSchema = z.object({
  report: businessAdoptionReportSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();

const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await readWalletSession();
    if (!session) throw new Error("AUTHENTICATION_REQUIRED");
    const task = (await protocolSnapshot()).tasks.find((item) => item.id === id);
    assertPublisherArtifactRelease({ task, sessionAddress: session.address });
    const release = await latestPublisherArtifactRelease(id, session.address);
    if (!release) throw new Error("ARTIFACT_RELEASE_REQUIRED");
    assertPublisherArtifactRelease({ task, sessionAddress: session.address, plaintextSha256: release.artifactHash.slice("sha256:".length) });
    const existing = await businessAdoptionForTask(id, release.artifactHash);
    if (existing) {
      return NextResponse.json({ adoption: {
        publisher: existing.publisher,
        artifactHash: existing.artifactHash,
        workflowType: existing.workflowType,
        workflowEvidenceHash: existing.workflowEvidenceHash,
        adoptedAt: existing.adoptedAt,
        reportHash: existing.reportHash,
        attestedAt: existing.createdAt,
      } }, { headers: privateHeaders });
    }
    return NextResponse.json({
      chainId: runtimeConfig().BSC_CHAIN_ID,
      release: {
        id: release.id,
        taskId: release.taskId,
        publisher: release.publisher,
        artifactHash: release.artifactHash,
        createdAt: release.createdAt,
      },
    }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const publisher = await requirePublisherRequest(request);
    await enforceRateLimit(`business-adoption:${publisher.toLowerCase()}`, 10, 60 * 60);
    const input = submissionSchema.parse(await readJsonBody(request));
    if (input.report.taskId !== id) throw new Error("BUSINESS_ADOPTION_TASK_MISMATCH");
    const task = (await protocolSnapshot()).tasks.find((item) => item.id === id);
    const release = await publisherArtifactReleaseById(input.report.releaseId, id, publisher);
    assertBusinessAdoptionEligibility({
      report: input.report,
      task,
      release,
      sessionAddress: publisher,
      expectedChainId: runtimeConfig().BSC_CHAIN_ID,
    });
    const verified = await verifyBusinessAdoptionSignature({
      report: input.report,
      signature: input.signature as `0x${string}`,
      expectedAddress: publisher,
    });
    if (await businessAdoptionForTask(id, input.report.artifactHash)) throw new Error("BUSINESS_ADOPTION_ALREADY_RECORDED");
    await storeBusinessAdoption({
      id: randomUUID(),
      taskId: id,
      publisher,
      releaseId: input.report.releaseId,
      chainId: input.report.chainId,
      artifactHash: input.report.artifactHash,
      workflowType: input.report.workflowType,
      workflowEvidenceHash: input.report.workflowEvidenceHash,
      adoptedAt: input.report.adoptedAt,
      reportHash: verified.reportHash,
      report: verified.report,
      signature: input.signature,
    });
    await audit({
      actor: publisher,
      action: "task.business_adoption.attest",
      target: id,
      requestId: requestId(request),
      payload: { artifactHash: input.report.artifactHash, workflowType: input.report.workflowType, reportHash: verified.reportHash },
    });
    return NextResponse.json({ ok: true, reportHash: verified.reportHash }, { status: 201, headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
