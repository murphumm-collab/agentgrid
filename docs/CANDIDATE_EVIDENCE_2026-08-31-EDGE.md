# AgentGrid TLS/WAF/trusted-proxy hardening evidence — unactivated candidate

Date: 2026-08-31 (Asia/Hong_Kong)

This record covers application controls and an unactivated local candidate. It
does not claim that a public domain, certificate, WAF, CDN, externally blocked
origin, or independent external vantage currently exists.

## Implemented controls

- `TRUST_PROXY=true` now requires a dedicated 32+ byte
  `TRUSTED_PROXY_SHARED_SECRET` supplied from a read-only Secret file.
- A request may use `X-Forwarded-For` only when
  `X-AgentGrid-Proxy-Auth` matches that secret in constant time.
- The accepted forwarding value must be exactly one valid IPv4/IPv6 address.
  Comma-appended chains, invalid values, missing/wrong proxy credentials and the
  old `X-Real-IP` fallback fail closed.
- The edge contract requires stripping all client-supplied forwarding/proxy-auth
  headers, replacing them with one canonical client IP and the trusted Secret.
- The Admin-authenticated `/api/admin/edge-probe` exposes only a SHA-256 client
  key and the proxy-trust state for spoof-overwrite verification.
- Production Compose now declares 14 external Secrets and mounts the proxy Secret
  only into Web.
- Browser responses add Cross-Origin-Resource-Policy, DNS-prefetch disablement,
  and production CSP `upgrade-insecure-requests` to the existing CSP/frame/
  content-type/referrer/permissions controls.

## External evidence gate

`pnpm ops:edge:verify` performs real target probes for:

- trusted certificate chain, hostname, TLS 1.2/1.3 and at least 30 days remaining;
- HTTP-to-HTTPS redirect, HSTS for at least one year with subdomains, CSP and all
  required browser security headers;
- edge marker, TRACE 405/501, a 12 MiB 413 and observed drill-rate 429;
- stripping of attacker-controlled `X-Forwarded-For`, `X-Real-IP`, and
  `X-AgentGrid-Proxy-Auth` values;
- stable proxy-injected client key and enabled authenticated proxy trust;
- a direct origin that is network-blocked or explicitly forbidden from an
  independent external vantage. Application 401 alone is deliberately not
  sufficient evidence of origin isolation.

The strict report binds chain 97, candidate build, deployment-manifest SHA-256,
target/vantage classes and hashed public/direct origins. The release gate rejects
local targets, non-independent vantage, stale reports, short-lived/invalid TLS,
missing headers/WAF controls, unproven proxy isolation and candidate/deployment
substitution. It reports `verifiedEdgeControlGroups: 0` until a valid final report
is present.

## Real-process verification

`pnpm ops:proxy:smoke` started a separate production standalone Next origin and
a sanitizing local reverse proxy on ephemeral ports. Two requests supplied
different attacker forwarding chains and attacker proxy credentials. The proxy
stripped them, injected its own single `127.0.0.1` identity and Secret, and both
requests returned the same expected SHA-256 client key. A direct origin request
with a valid Admin credential but without proxy authentication returned HTTP 401
and `TRUSTED_PROXY_AUTHENTICATION_REQUIRED`.

This proves the application/proxy contract, not the external network controls.

## Candidate and QA

Latest unactivated Web candidate:

- Build ID: `K7uDtpcHFkrLb6jqi_zih`
- Directory:
  `<agentgrid-workspace>/local-releases/agentgrid-20260830T224728Z-K7uDtpcH`
- Payload SHA-256:
  `sha256:4d30f8f8eebefd55ff905d05a1a00e0690788bccb4d3858a9108f2597b522840`
- Payload entries/bytes: `2542` / `68651257`
- Release-manifest SHA-256:
  `373d55e72c51b037a79513bb8980783afa0db0ec7a44d1c5263a1ac052baaded`

Verification completed:

- TypeScript and ESLint passed.
- 37 application test files, 151 tests passed.
- 14 Worker/Ops entry bundles built, including `edgeVerify`.
- Next production build generated 22 routes, including the Admin edge probe.
- Production Compose expanded 13 services and 14 external Secrets.
- Trusted-proxy and monitoring local smokes passed.
- Production dependency audit reported no known vulnerabilities.
- The sealed candidate served `/` and `/agents/integration` with HTTP 200 on
  temporary port 3101; CSP upgrade/security headers were observed.
- Its authenticated release report remained correctly false with
  `verifiedEdgeControlGroups: 0`; port 3101 was stopped.

This is not the final uninterrupted 21-command QA report and cannot replace it.

## Deployed-version invariant

The existing deployment was not changed or restarted:

- PID `52463`, started `Mon Aug 31 01:29:49 2026`.
- Working directory remains
  `<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`.
- `/` and `/agents/integration` remained HTTP 200 after the work.

## External blockers still open

- A real domain/CDN/WAF and independent external probe environment.
- Exact origin firewall/private-network policy and edge Secret injection.
- Funded BSC Testnet deployment, tBNB and independent pilot wallets.
- Target KMS custody/recovery, KMS-encrypted off-host restore and production alert
  receiver drill.
- Independent Solidity and Web/API audits, real-user adoption/sign-offs, final
  21-command QA, image provenance and release signatures.
