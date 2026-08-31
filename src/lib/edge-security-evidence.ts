import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/).refine((value) => !/^sha256:0{64}$/.test(value));

export const edgeSecurityReportSchema = z.object({
  version: z.literal(1),
  scope: z.literal("agentgrid-tls-waf-trusted-proxy"),
  chainId: z.literal(97),
  candidateBuildId: z.string().min(8).max(128),
  deploymentManifestSha256: sha256Schema,
  startedAt: z.string().datetime({ offset: true }),
  observedAt: z.string().datetime({ offset: true }),
  target: z.object({
    targetClass: z.enum(["production-edge", "local-smoke"]),
    vantageClass: z.enum(["external-independent", "local-smoke"]),
    provider: z.string().min(2).max(96),
    publicOriginHash: sha256Schema,
    directOriginHash: sha256Schema,
    edgeMarkerHeader: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    edgeMarkerValueHash: sha256Schema,
    edgeMarkerObserved: z.boolean(),
  }).strict(),
  tls: z.object({
    hostnameVerified: z.boolean(),
    chainVerified: z.boolean(),
    protocol: z.enum(["TLSv1.2", "TLSv1.3", "local-smoke"]),
    certificateFingerprintSha256: sha256Schema,
    validFrom: z.string().datetime({ offset: true }),
    validTo: z.string().datetime({ offset: true }),
    daysRemaining: z.number().int(),
  }).strict(),
  redirect: z.object({
    status: z.number().int().min(300).max(399),
    locationUsesHttps: z.boolean(),
    locationHostMatches: z.boolean(),
  }).strict(),
  headers: z.object({
    strictTransportSecurity: z.boolean(),
    hstsMaxAgeSeconds: z.number().int().nonnegative(),
    hstsIncludeSubDomains: z.boolean(),
    contentSecurityPolicy: z.boolean(),
    frameAncestorsNone: z.boolean(),
    contentTypeNosniff: z.boolean(),
    frameOptionsDeny: z.boolean(),
    referrerPolicy: z.boolean(),
    permissionsPolicy: z.boolean(),
    crossOriginOpenerPolicy: z.boolean(),
    crossOriginResourcePolicy: z.boolean(),
    poweredByAbsent: z.boolean(),
  }).strict(),
  waf: z.object({
    traceRejected: z.boolean(),
    traceStatus: z.number().int().min(400).max(599),
    oversizedBodyRejected: z.boolean(),
    oversizedBodyStatus: z.number().int().min(400).max(599),
    attemptedBodyBytes: z.number().int().min(11 * 1_048_576).max(16 * 1_048_576),
    rateLimitObserved: z.boolean(),
    rateLimitStatus: z.number().int().min(400).max(599),
    rateLimitAttempts: z.number().int().min(2).max(200),
  }).strict(),
  proxy: z.object({
    trustProxyEnabled: z.boolean(),
    authenticatedProxyHeaderRequired: z.boolean(),
    spoofedForwardedForOverwritten: z.boolean(),
    clientKeyStable: z.boolean(),
    directOriginBlocked: z.boolean(),
    directOriginResult: z.enum(["network-blocked", "unauthorized", "forbidden", "local-smoke"]),
  }).strict(),
}).strict();

export type EdgeSecurityReport = z.infer<typeof edgeSecurityReportSchema>;

export function verifyEdgeSecurityReport(raw: unknown, now = new Date()) {
  const report = edgeSecurityReportSchema.parse(raw);
  const startedAt = new Date(report.startedAt).getTime();
  const observedAt = new Date(report.observedAt).getTime();
  const validFrom = new Date(report.tls.validFrom).getTime();
  const validTo = new Date(report.tls.validTo).getTime();
  if (observedAt < startedAt || observedAt > now.getTime() + 5 * 60_000) throw new Error("EDGE_EVIDENCE_TIME_INVALID");
  if (validTo <= validFrom || report.tls.daysRemaining !== Math.floor((validTo - observedAt) / 86_400_000)) {
    throw new Error("EDGE_EVIDENCE_CERTIFICATE_TIME_INVALID");
  }
  return report;
}

export function edgeSecurityBindingBlockers(input: {
  report: EdgeSecurityReport;
  candidateBuildId: string;
  candidateCreatedAt: string;
  deploymentManifestSha256: string;
  releaseCreatedAt: string;
}) {
  const blockers: string[] = [];
  const report = input.report;
  const releaseAt = new Date(input.releaseCreatedAt).getTime();
  const observedAt = new Date(report.observedAt).getTime();
  if (report.candidateBuildId !== input.candidateBuildId) blockers.push("PRODUCTION_RELEASE_EDGE_CANDIDATE_MISMATCH");
  if (report.deploymentManifestSha256 !== input.deploymentManifestSha256) blockers.push("PRODUCTION_RELEASE_EDGE_DEPLOYMENT_MISMATCH");
  if (new Date(report.startedAt).getTime() < new Date(input.candidateCreatedAt).getTime()) blockers.push("PRODUCTION_RELEASE_EDGE_PREDATES_CANDIDATE");
  if (observedAt > releaseAt) blockers.push("PRODUCTION_RELEASE_PREDATES_EDGE_EVIDENCE");
  if (releaseAt - observedAt > 7 * 86_400_000) blockers.push("PRODUCTION_RELEASE_EDGE_EVIDENCE_STALE");
  if (report.target.targetClass !== "production-edge" || report.target.vantageClass !== "external-independent") {
    blockers.push("PRODUCTION_RELEASE_EDGE_TARGET_NOT_PRODUCTION");
  }
  if (!report.target.edgeMarkerObserved) blockers.push("PRODUCTION_RELEASE_EDGE_MARKER_MISSING");
  if (!report.tls.hostnameVerified || !report.tls.chainVerified || report.tls.protocol === "local-smoke" || report.tls.daysRemaining < 30) {
    blockers.push("PRODUCTION_RELEASE_TLS_INVALID");
  }
  if (![301, 302, 307, 308].includes(report.redirect.status)
    || !report.redirect.locationUsesHttps || !report.redirect.locationHostMatches) blockers.push("PRODUCTION_RELEASE_HTTPS_REDIRECT_INVALID");
  const headers = report.headers;
  if (!headers.strictTransportSecurity || headers.hstsMaxAgeSeconds < 31_536_000 || !headers.hstsIncludeSubDomains
    || !headers.contentSecurityPolicy || !headers.frameAncestorsNone || !headers.contentTypeNosniff
    || !headers.frameOptionsDeny || !headers.referrerPolicy || !headers.permissionsPolicy
    || !headers.crossOriginOpenerPolicy || !headers.crossOriginResourcePolicy || !headers.poweredByAbsent) {
    blockers.push("PRODUCTION_RELEASE_EDGE_HEADERS_INCOMPLETE");
  }
  if (!report.waf.traceRejected || ![405, 501].includes(report.waf.traceStatus)
    || !report.waf.oversizedBodyRejected || report.waf.oversizedBodyStatus !== 413
    || !report.waf.rateLimitObserved || report.waf.rateLimitStatus !== 429) blockers.push("PRODUCTION_RELEASE_WAF_CONTROLS_UNPROVEN");
  if (!report.proxy.trustProxyEnabled || !report.proxy.authenticatedProxyHeaderRequired
    || !report.proxy.spoofedForwardedForOverwritten || !report.proxy.clientKeyStable
    || !report.proxy.directOriginBlocked || !["network-blocked", "forbidden"].includes(report.proxy.directOriginResult)) {
    blockers.push("PRODUCTION_RELEASE_TRUSTED_PROXY_UNPROVEN");
  }
  return [...new Set(blockers)];
}
