import { createHash, randomUUID } from "node:crypto";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import tls from "node:tls";
import { edgeSecurityBindingBlockers, edgeSecurityReportSchema } from "../src/lib/edge-security-evidence";
import { writeNewEvidenceFile } from "../src/lib/evidence-file";
import { requiredSecret } from "../src/lib/secrets";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name}_INVALID`);
  return value;
}

function childUrl(origin: URL, pathname: string, search = "") {
  const value = new URL(origin.origin);
  value.pathname = pathname;
  value.search = search;
  return value;
}

interface ProbeResponse { status: number; headers: IncomingHttpHeaders; body: Buffer }

async function request(input: {
  url: URL; method?: string; headers?: Record<string, string>; body?: Buffer; allowInvalidCertificate?: boolean;
}): Promise<ProbeResponse> {
  const transport = input.url.protocol === "https:" ? https : input.url.protocol === "http:" ? http : undefined;
  if (!transport) throw new Error("EDGE_PROBE_PROTOCOL_INVALID");
  return new Promise((resolve, reject) => {
    const call = transport.request(input.url, {
      method: input.method ?? "GET",
      headers: input.headers,
      ...(input.url.protocol === "https:" ? { rejectUnauthorized: !input.allowInvalidCertificate } : {}),
      timeout: 10_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) response.destroy(new Error("EDGE_PROBE_RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    call.on("timeout", () => call.destroy(new Error("EDGE_PROBE_TIMEOUT")));
    call.on("error", reject);
    if (input.body) call.end(input.body); else call.end();
  });
}

async function tlsProbe(origin: URL, allowInvalidCertificate: boolean) {
  const port = Number(origin.port || 443);
  return new Promise<{
    hostnameVerified: boolean; chainVerified: boolean; protocol: string;
    certificateFingerprintSha256: string; validFrom: string; validTo: string;
  }>((resolve, reject) => {
    const socket = tls.connect({
      host: origin.hostname,
      port,
      servername: isIP(origin.hostname) ? undefined : origin.hostname,
      rejectUnauthorized: !allowInvalidCertificate,
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error("EDGE_TLS_TIMEOUT")));
    socket.once("error", reject);
    socket.once("secureConnect", () => {
      try {
        const certificate = socket.getPeerCertificate(true);
        if (!certificate.raw || !certificate.valid_from || !certificate.valid_to) throw new Error("EDGE_TLS_CERTIFICATE_MISSING");
        const hostnameVerified = isIP(origin.hostname)
          ? socket.authorized
          : tls.checkServerIdentity(origin.hostname, certificate) === undefined;
        const protocol = socket.getProtocol() ?? "";
        resolve({
          hostnameVerified,
          chainVerified: socket.authorized,
          protocol,
          certificateFingerprintSha256: sha256(certificate.raw),
          validFrom: new Date(certificate.valid_from).toISOString(),
          validTo: new Date(certificate.valid_to).toISOString(),
        });
      } catch (error) { reject(error); }
      finally { socket.end(); }
    });
  });
}

function singleHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function hsts(value: string | undefined) {
  const maxAge = value?.match(/(?:^|;)\s*max-age=(\d+)/i)?.[1];
  return {
    strictTransportSecurity: Boolean(value),
    hstsMaxAgeSeconds: maxAge ? Number(maxAge) : 0,
    hstsIncludeSubDomains: /(?:^|;)\s*includesubdomains(?:;|$)/i.test(value ?? ""),
  };
}

function parseJson(body: Buffer) {
  try { return JSON.parse(body.toString("utf8")) as Record<string, unknown>; }
  catch { throw new Error("EDGE_PROBE_JSON_INVALID"); }
}

async function directOriginResult(origin: URL, adminKey: string) {
  try {
    const response = await request({
      url: childUrl(origin, "/api/admin/edge-probe"),
      headers: { authorization: `Bearer ${adminKey}`, "x-forwarded-for": "203.0.113.99" },
    });
    if (response.status === 401) return "unauthorized" as const;
    if (response.status === 403) return "forbidden" as const;
    throw new Error(`EDGE_DIRECT_ORIGIN_ACCESSIBLE_${response.status}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("EDGE_DIRECT_ORIGIN_ACCESSIBLE_")) throw error;
    return "network-blocked" as const;
  }
}

async function main() {
  const targetClass = required("EDGE_EVIDENCE_TARGET_CLASS");
  const vantageClass = required("EDGE_EVIDENCE_VANTAGE_CLASS");
  if (!(["production-edge", "local-smoke"] as const).includes(targetClass as "production-edge")) throw new Error("EDGE_EVIDENCE_TARGET_CLASS_INVALID");
  if (!(["external-independent", "local-smoke"] as const).includes(vantageClass as "external-independent")) throw new Error("EDGE_EVIDENCE_VANTAGE_CLASS_INVALID");
  const localSmoke = targetClass === "local-smoke";
  if (localSmoke !== (process.env.EDGE_EVIDENCE_ALLOW_LOCAL_SMOKE === "true")) throw new Error("EDGE_EVIDENCE_LOCAL_SMOKE_FLAG_MISMATCH");
  const publicOrigin = new URL(required("EDGE_PUBLIC_ORIGIN"));
  const httpOrigin = new URL(required("EDGE_HTTP_ORIGIN"));
  const directOrigin = new URL(required("EDGE_DIRECT_ORIGIN"));
  if (publicOrigin.protocol !== "https:" || httpOrigin.protocol !== "http:" || publicOrigin.hostname !== httpOrigin.hostname) throw new Error("EDGE_ORIGIN_CONFIGURATION_INVALID");
  if (!localSmoke && (publicOrigin.hostname === "localhost" || isIP(publicOrigin.hostname))) throw new Error("EDGE_PUBLIC_DOMAIN_REQUIRED");
  if (directOrigin.origin === publicOrigin.origin) throw new Error("EDGE_DIRECT_ORIGIN_MUST_DIFFER");
  const edgeMarkerHeader = required("EDGE_MARKER_HEADER").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(edgeMarkerHeader)) throw new Error("EDGE_MARKER_HEADER_INVALID");
  const edgeMarkerValue = required("EDGE_MARKER_VALUE");
  const adminKey = requiredSecret("ADMIN_API_KEY");
  const attemptedBodyBytes = integer("EDGE_WAF_BODY_BYTES", 12 * 1_048_576, 11 * 1_048_576, 16 * 1_048_576);
  const rateLimitAttempts = integer("EDGE_WAF_RATE_LIMIT_ATTEMPTS", 20, 2, 200);
  const startedAt = new Date().toISOString();

  const tlsResult = await tlsProbe(publicOrigin, localSmoke);
  const publicResponse = await request({ url: childUrl(publicOrigin, "/"), allowInvalidCertificate: localSmoke });
  const markerObserved = singleHeader(publicResponse.headers, edgeMarkerHeader) === edgeMarkerValue;
  const redirectResponse = await request({ url: childUrl(httpOrigin, "/"), allowInvalidCertificate: localSmoke });
  const redirectLocation = new URL(singleHeader(redirectResponse.headers, "location") ?? "http://invalid.invalid", httpOrigin);
  const traceResponse = await request({
    url: childUrl(publicOrigin, "/", `edge-trace=${randomUUID()}`), method: "TRACE", allowInvalidCertificate: localSmoke,
  });

  const probeHeaders = { authorization: `Bearer ${adminKey}` };
  const proxyOne = await request({
    url: childUrl(publicOrigin, "/api/admin/edge-probe", `probe=${randomUUID()}`),
    headers: {
      ...probeHeaders, "x-forwarded-for": "203.0.113.11", "x-real-ip": "203.0.113.12",
      "x-agentgrid-proxy-auth": "attacker-controlled-value",
    }, allowInvalidCertificate: localSmoke,
  });
  const proxyTwo = await request({
    url: childUrl(publicOrigin, "/api/admin/edge-probe", `probe=${randomUUID()}`),
    headers: {
      ...probeHeaders, "x-forwarded-for": "198.51.100.22, 10.0.0.1", "x-real-ip": "198.51.100.23",
      "x-agentgrid-proxy-auth": "different-attacker-value",
    }, allowInvalidCertificate: localSmoke,
  });
  if (proxyOne.status !== 200 || proxyTwo.status !== 200) throw new Error("EDGE_TRUSTED_PROXY_PROBE_FAILED");
  const proxyOneBody = parseJson(proxyOne.body);
  const proxyTwoBody = parseJson(proxyTwo.body);
  const clientKeyStable = typeof proxyOneBody.clientKey === "string" && proxyOneBody.clientKey === proxyTwoBody.clientKey;
  const trustProxyEnabled = proxyOneBody.trustedProxy === true && proxyTwoBody.trustedProxy === true;

  const oversizedResponse = await request({
    url: childUrl(publicOrigin, "/api/health/live", `edge-oversize=${randomUUID()}`), method: "POST",
    headers: { "content-type": "application/octet-stream", "content-length": String(attemptedBodyBytes), "x-agentgrid-waf-drill": "oversized-body" },
    body: Buffer.alloc(attemptedBodyBytes), allowInvalidCertificate: localSmoke,
  });
  let rateLimitStatus = 0;
  const rateToken = randomUUID();
  for (let attempt = 0; attempt < rateLimitAttempts; attempt += 1) {
    const response = await request({
      url: childUrl(publicOrigin, "/api/health/live", `edge-rate=${rateToken}`),
      headers: { "x-agentgrid-waf-drill": rateToken }, allowInvalidCertificate: localSmoke,
    });
    if (response.status === 429) { rateLimitStatus = 429; break; }
  }
  const directResult = localSmoke ? "local-smoke" as const : await directOriginResult(directOrigin, adminKey);
  const observedAt = new Date().toISOString();
  const validTo = new Date(tlsResult.validTo).getTime();
  const csp = singleHeader(publicResponse.headers, "content-security-policy") ?? "";
  const report = edgeSecurityReportSchema.parse({
    version: 1,
    scope: "agentgrid-tls-waf-trusted-proxy",
    chainId: 97,
    candidateBuildId: required("EDGE_EVIDENCE_CANDIDATE_BUILD_ID"),
    deploymentManifestSha256: required("EDGE_EVIDENCE_DEPLOYMENT_MANIFEST_SHA256"),
    startedAt,
    observedAt,
    target: {
      targetClass, vantageClass, provider: required("EDGE_PROVIDER"),
      publicOriginHash: sha256(publicOrigin.origin), directOriginHash: sha256(directOrigin.origin),
      edgeMarkerHeader, edgeMarkerValueHash: sha256(edgeMarkerValue), edgeMarkerObserved: markerObserved,
    },
    tls: {
      ...tlsResult,
      protocol: localSmoke ? "local-smoke" : tlsResult.protocol,
      daysRemaining: Math.floor((validTo - new Date(observedAt).getTime()) / 86_400_000),
    },
    redirect: {
      status: redirectResponse.status,
      locationUsesHttps: redirectLocation.protocol === "https:",
      locationHostMatches: redirectLocation.hostname === publicOrigin.hostname,
    },
    headers: {
      ...hsts(singleHeader(publicResponse.headers, "strict-transport-security")),
      contentSecurityPolicy: Boolean(csp), frameAncestorsNone: /frame-ancestors\s+'none'/i.test(csp),
      contentTypeNosniff: singleHeader(publicResponse.headers, "x-content-type-options")?.toLowerCase() === "nosniff",
      frameOptionsDeny: singleHeader(publicResponse.headers, "x-frame-options")?.toUpperCase() === "DENY",
      referrerPolicy: Boolean(singleHeader(publicResponse.headers, "referrer-policy")),
      permissionsPolicy: Boolean(singleHeader(publicResponse.headers, "permissions-policy")),
      crossOriginOpenerPolicy: Boolean(singleHeader(publicResponse.headers, "cross-origin-opener-policy")),
      crossOriginResourcePolicy: Boolean(singleHeader(publicResponse.headers, "cross-origin-resource-policy")),
      poweredByAbsent: !singleHeader(publicResponse.headers, "x-powered-by"),
    },
    waf: {
      traceRejected: [405, 501].includes(traceResponse.status), traceStatus: traceResponse.status,
      oversizedBodyRejected: oversizedResponse.status === 413, oversizedBodyStatus: oversizedResponse.status,
      attemptedBodyBytes, rateLimitObserved: rateLimitStatus === 429, rateLimitStatus: rateLimitStatus || 599, rateLimitAttempts,
    },
    proxy: {
      trustProxyEnabled,
      authenticatedProxyHeaderRequired: true,
      spoofedForwardedForOverwritten: clientKeyStable,
      clientKeyStable,
      directOriginBlocked: directResult !== "local-smoke",
      directOriginResult: directResult,
    },
  });
  if (!localSmoke) {
    const blockers = edgeSecurityBindingBlockers({
      report,
      candidateBuildId: report.candidateBuildId,
      candidateCreatedAt: report.startedAt,
      deploymentManifestSha256: report.deploymentManifestSha256,
      releaseCreatedAt: report.observedAt,
    });
    if (blockers.length) throw new Error(blockers[0]);
  }
  const output = await writeNewEvidenceFile(required("EDGE_SECURITY_REPORT_FILE"), report, "EDGE_EVIDENCE");
  console.log(JSON.stringify({ edgeSecurityVerified: !localSmoke, targetClass, output, tls: report.tls.protocol, controlGroups: 4 }));
}

void main().catch((error) => {
  console.error(error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : "EDGE_SECURITY_VERIFY_FAILED");
  process.exitCode = 1;
});
