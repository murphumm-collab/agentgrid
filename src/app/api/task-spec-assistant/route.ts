import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePublisherRequest } from "@/lib/auth";
import { isProductionMode } from "@/lib/env";
import { apiError } from "@/lib/http";
import { readJsonBody } from "@/lib/request-body";
import { audit, enforceRateLimit, requestClientKey, requestId } from "@/lib/security";
import { clarifyTaskSpecification, requiredExternalAiReviewBlockers } from "@/lib/task-spec-assistant";
import { assessTaskDefinition, collaborationPlanBlockers, taskClarificationDraftSchema, taskDefinitionHash, taskDefinitionReviewBindingHash, verificationPlanBlockers } from "@/lib/task-definition";
import { storeTaskDefinitionReview } from "@/lib/store-postgres";
import { taskSpecAssistantResponseSchema } from "@/lib/production-response-schema";

const privateHeaders = { "cache-control": "private, no-store", vary: "Cookie" };

export async function POST(request: NextRequest) {
  try {
    const draft = taskClarificationDraftSchema.parse(await readJsonBody(request));
    const publisher = isProductionMode() ? await requirePublisherRequest(request, draft.publisher) : draft.publisher;
    await enforceRateLimit(`task-spec-assistant:${publisher.toLowerCase()}:${requestClientKey(request)}`, 6, 60 * 60);
    const result = await clarifyTaskSpecification({ ...draft, publisher });
    const baseAssessment = assessTaskDefinition(result.recommendation);
    const unanswered = result.reviews.flatMap((item) => item.review.clarifyingQuestions).filter((item) => item.blocking);
    const questionBlockers = [...new Set(unanswered.map((item) => `UNANSWERED_${item.id.toUpperCase().replaceAll("-", "_")}`))];
    const aiBlockers = requiredExternalAiReviewBlockers(result.reviews, isProductionMode());
    const collaborationBlockers = collaborationPlanBlockers(result.recommendation, draft.executionMode, draft.maxExecutors);
    const verificationBlockers = verificationPlanBlockers(result.recommendation);
    const assessment = {
      ...baseAssessment,
      ready: baseAssessment.ready && questionBlockers.length === 0 && aiBlockers.length === 0 && collaborationBlockers.length === 0 && verificationBlockers.length === 0,
      score: Math.max(0, baseAssessment.score - (questionBlockers.length + aiBlockers.length + collaborationBlockers.length + verificationBlockers.length) * 15),
      blockers: [...questionBlockers, ...aiBlockers, ...collaborationBlockers, ...verificationBlockers, ...baseAssessment.blockers],
    };
    const definitionHash = taskDefinitionHash(result.recommendation);
    const reviewedTaskHash = taskDefinitionReviewBindingHash({
      title: draft.title,
      businessOutcome: draft.businessOutcome,
      category: draft.category,
      executionMode: draft.executionMode,
      maxExecutors: draft.maxExecutors,
      completionDefinition: result.recommendation,
    });
    let definitionReview: { id: string; expiresAt: string } | null = null;
    if (isProductionMode() && assessment.ready) {
      const stored = await storeTaskDefinitionReview({
        id: randomUUID(), publisher, reviewedTaskHash, definitionHash,
        recommendation: result.recommendation,
        reviewers: result.reviews,
        assessment, expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1_000),
      });
      definitionReview = { id: stored.id, expiresAt: new Date(stored.expiresAt).toISOString() };
    }
    await audit({ actor: publisher, action: "TASK_SPEC_ASSISTED", target: definitionHash, requestId: requestId(request), payload: { aiAvailable: result.aiAvailable, reviewers: result.reviews.map((item) => ({ role: item.role, provider: item.provider, model: item.model, reportHash: item.reportHash })), assessment } });
    return NextResponse.json(taskSpecAssistantResponseSchema.parse({ ...result, assessment, definitionHash, reviewedTaskHash, definitionReview }), { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
