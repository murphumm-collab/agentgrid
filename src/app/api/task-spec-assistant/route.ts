import { NextRequest, NextResponse } from "next/server";
import { requirePublisherRequest } from "@/lib/auth";
import { isProductionMode } from "@/lib/env";
import { apiError } from "@/lib/http";
import { readJsonBody } from "@/lib/request-body";
import { audit, enforceRateLimit, requestClientKey, requestId } from "@/lib/security";
import { clarifyTaskSpecification } from "@/lib/task-spec-assistant";
import { assessTaskDefinition, taskClarificationDraftSchema, taskDefinitionHash } from "@/lib/task-definition";

export async function POST(request: NextRequest) {
  try {
    const draft = taskClarificationDraftSchema.parse(await readJsonBody(request));
    const publisher = isProductionMode() ? await requirePublisherRequest(request, draft.publisher) : draft.publisher;
    await enforceRateLimit(`task-spec-assistant:${publisher.toLowerCase()}:${requestClientKey(request)}`, 6, 60 * 60);
    const result = await clarifyTaskSpecification({ ...draft, publisher });
    const baseAssessment = assessTaskDefinition(result.recommendation);
    const unanswered = result.reviews.flatMap((item) => item.review.clarifyingQuestions).filter((item) => item.blocking);
    const questionBlockers = [...new Set(unanswered.map((item) => `UNANSWERED_${item.id.toUpperCase().replaceAll("-", "_")}`))];
    const assessment = {
      ...baseAssessment,
      ready: baseAssessment.ready && questionBlockers.length === 0,
      score: Math.max(0, baseAssessment.score - questionBlockers.length * 15),
      blockers: [...questionBlockers, ...baseAssessment.blockers],
    };
    const definitionHash = taskDefinitionHash(result.recommendation);
    await audit({ actor: publisher, action: "TASK_SPEC_ASSISTED", target: definitionHash, requestId: requestId(request), payload: { aiAvailable: result.aiAvailable, reviewers: result.reviews.map((item) => ({ role: item.role, provider: item.provider, model: item.model, reportHash: item.reportHash })), assessment } });
    return NextResponse.json({ ...result, assessment, definitionHash });
  } catch (error) { return apiError(error); }
}
