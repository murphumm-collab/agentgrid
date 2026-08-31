import { describe, expect, it } from "vitest";
import { edgeSecurityBindingBlockers, verifyEdgeSecurityReport, type EdgeSecurityReport } from "./edge-security-evidence";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function fixture(): EdgeSecurityReport {
  return {
    version: 1,
    scope: "agentgrid-tls-waf-trusted-proxy",
    chainId: 97,
    candidateBuildId: "candidate-build-123",
    deploymentManifestSha256: hash("a"),
    startedAt: "2026-08-31T00:00:00.000Z",
    observedAt: "2026-08-31T00:01:00.000Z",
    target: {
      targetClass: "production-edge", vantageClass: "external-independent", provider: "production-edge-provider",
      publicOriginHash: hash("b"), directOriginHash: hash("c"), edgeMarkerHeader: "x-agentgrid-edge",
      edgeMarkerValueHash: hash("d"), edgeMarkerObserved: true,
    },
    tls: {
      hostnameVerified: true, chainVerified: true, protocol: "TLSv1.3", certificateFingerprintSha256: hash("e"),
      validFrom: "2026-08-01T00:00:00.000Z", validTo: "2026-11-29T00:01:00.000Z", daysRemaining: 90,
    },
    redirect: { status: 308, locationUsesHttps: true, locationHostMatches: true },
    headers: {
      strictTransportSecurity: true, hstsMaxAgeSeconds: 31_536_000, hstsIncludeSubDomains: true,
      contentSecurityPolicy: true, frameAncestorsNone: true, contentTypeNosniff: true, frameOptionsDeny: true,
      referrerPolicy: true, permissionsPolicy: true, crossOriginOpenerPolicy: true,
      crossOriginResourcePolicy: true, poweredByAbsent: true,
    },
    waf: {
      traceRejected: true, traceStatus: 405, oversizedBodyRejected: true, oversizedBodyStatus: 413,
      attemptedBodyBytes: 12 * 1_048_576, rateLimitObserved: true, rateLimitStatus: 429, rateLimitAttempts: 20,
    },
    proxy: {
      trustProxyEnabled: true, authenticatedProxyHeaderRequired: true, spoofedForwardedForOverwritten: true,
      clientKeyStable: true, directOriginBlocked: true, directOriginResult: "network-blocked",
    },
  };
}

describe("TLS/WAF/trusted-proxy evidence", () => {
  it("accepts a complete fresh externally observed production edge report", () => {
    const report = verifyEdgeSecurityReport(fixture(), new Date("2026-08-31T00:02:00.000Z"));
    expect(edgeSecurityBindingBlockers({
      report, candidateBuildId: report.candidateBuildId, candidateCreatedAt: "2026-08-30T23:59:00.000Z",
      deploymentManifestSha256: report.deploymentManifestSha256, releaseCreatedAt: "2026-08-31T00:02:00.000Z",
    })).toEqual([]);
  });

  it("rejects inconsistent certificate time", () => {
    const report = fixture();
    report.tls.daysRemaining = 89;
    expect(() => verifyEdgeSecurityReport(report, new Date("2026-08-31T00:02:00.000Z"))).toThrow("EDGE_EVIDENCE_CERTIFICATE_TIME_INVALID");
  });

  it("blocks local, stale, substituted and incomplete edge claims", () => {
    const report = fixture();
    report.target.targetClass = "local-smoke";
    report.target.vantageClass = "local-smoke";
    report.target.edgeMarkerObserved = false;
    report.tls.hostnameVerified = false;
    report.tls.chainVerified = false;
    report.tls.protocol = "local-smoke";
    report.tls.daysRemaining = 1;
    report.redirect.locationUsesHttps = false;
    report.headers.strictTransportSecurity = false;
    report.waf.rateLimitObserved = false;
    report.proxy.directOriginResult = "local-smoke";
    expect(edgeSecurityBindingBlockers({
      report, candidateBuildId: "other-candidate", candidateCreatedAt: "2026-08-31T00:02:00.000Z",
      deploymentManifestSha256: hash("f"), releaseCreatedAt: "2026-09-10T00:00:00.000Z",
    })).toEqual([
      "PRODUCTION_RELEASE_EDGE_CANDIDATE_MISMATCH", "PRODUCTION_RELEASE_EDGE_DEPLOYMENT_MISMATCH",
      "PRODUCTION_RELEASE_EDGE_PREDATES_CANDIDATE", "PRODUCTION_RELEASE_EDGE_EVIDENCE_STALE",
      "PRODUCTION_RELEASE_EDGE_TARGET_NOT_PRODUCTION", "PRODUCTION_RELEASE_EDGE_MARKER_MISSING",
      "PRODUCTION_RELEASE_TLS_INVALID", "PRODUCTION_RELEASE_HTTPS_REDIRECT_INVALID",
      "PRODUCTION_RELEASE_EDGE_HEADERS_INCOMPLETE", "PRODUCTION_RELEASE_WAF_CONTROLS_UNPROVEN",
      "PRODUCTION_RELEASE_TRUSTED_PROXY_UNPROVEN",
    ]);
  });
});
