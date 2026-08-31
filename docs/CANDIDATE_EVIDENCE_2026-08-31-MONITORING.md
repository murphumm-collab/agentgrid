# AgentGrid acknowledged monitoring evidence — unactivated candidate

Date: 2026-08-31 (Asia/Hong_Kong)

This record covers source and the unactivated candidate below. It is not a BSC
deployment, production alert-receiver observation, independent audit, real-user
pilot, or activation approval.

## Outcome

- Operational delivery now fails closed unless the HTTPS receiver returns a
  bounded strict acknowledgement matching the request UUID, event kind and exact
  request-body SHA-256.
- The acknowledgement itself carries a domain-separated HMAC verified with a
  constant-time comparison. HTTP 2xx alone is no longer delivery evidence.
- The monitor distinguishes alert, reminder and recovery events. Failed
  delivery does not advance its fingerprint/reminder state.
- `ops:monitor:drill` sends alert, delayed reminder and recovery, then writes a
  mode-0600 report bound to chain 97, exact candidate build and exact deployment
  manifest hash.
- The production release gate parses that report, requires exactly three valid
  acknowledgements, a production HTTPS target, a delay of at least 30 seconds,
  production environment, candidate/deployment equality, post-candidate timing
  and freshness within seven days.
- The loopback drill is explicitly labelled and rejected as production evidence.

## Candidate integrity correction

The previous local manifest hashed only `server.js`. Two different builds showed
the same entry hash because Next.js application code is stored in chunks. The
version-2 manifest now hashes every payload file and safe internal package link,
records entry/byte counts, rejects broken/absolute/escaping/mutable-target links,
and seals all payload paths read-only. Only owner-only `.next/cache` remains
mutable and is explicitly excluded.

Current unactivated candidate:

- Build ID: `UuaJ1v9vbqB94UcfqTYbA`
- Directory:
  `<agentgrid-workspace>/local-releases/agentgrid-20260830T223342Z-UuaJ1v9v`
- Payload SHA-256:
  `sha256:97c083d91e2877bd532f4f2f476d2d2fed282d25844107d4ac8d04b242905cc9`
- Payload entries: `2538`
- Payload bytes: `68607610`
- Release-manifest file SHA-256:
  `6c7093544302a33548c49a08bbc1b4b6ec469dcabf71ceb278bf25906477affb`
- Payload root mode: `0555`; cache mode: `0700`.

The sealed candidate served `/` and `/agents/integration` with HTTP 200 on the
temporary port 3101. Re-hashing after serving produced the same payload digest.
The authenticated release-readiness route exposed
`verifiedMonitoringEvents: 0` and remained false because no final evidence
bundle/pilot exists. Port 3101 was then stopped.

## Verification

- TypeScript: passed.
- ESLint: passed.
- Application tests: 35 files, 144 tests passed.
- Focused monitoring tests cover HMAC request/response binding, exact ACK fields,
  weak secrets, insecure destinations, oversized/missing/mismatched responses,
  event transitions, evidence substitution, duplicate deliveries, chronology,
  target class and release bindings.
- Candidate tests cover safe internal links, escaping-link rejection, read-only
  sealing and changed-chunk detection with an unchanged `server.js`.
- Worker build: 13 bundles passed, including the one-shot monitoring drill.
- Next production build: 21 static/dynamic pages generated.
- Production Compose: 13 services and 13 external Secret mounts passed.
- Production dependency audit: no known vulnerabilities.

Retained local-smoke report:

- File:
  `<agentgrid-workspace>/release-evidence/monitoring-alert-drill-local-smoke-20260831-0634.json`
- Mode/size: `0600`, `3359` bytes.
- SHA-256:
  `7ed8f1152bf69295e0c4b7bb90b86a3d0c915bd054c92bfe67cfd5d42fdddc94`
- It contains three acknowledgement HMACs and is deliberately blocked by:
  `PRODUCTION_RELEASE_MONITORING_TARGET_NOT_PRODUCTION`,
  `PRODUCTION_RELEASE_MONITORING_ENVIRONMENT_MISMATCH`, and
  `PRODUCTION_RELEASE_MONITORING_REMINDER_DRILL_TOO_SHORT`.

Two incomplete candidates created while discovering symlink-copy behavior were
never started and were moved to the macOS Trash rather than deleted permanently.

## Deployed-version invariant

The existing deployment was not modified, restarted or activated:

- PID: `52463`
- Start time: `Mon Aug 31 01:29:49 2026`
- Working directory:
  `<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`
- `/` and `/agents/integration`: HTTP 200 after all work.

## Still required for production

- Run the 30-second-or-longer drill against the real HTTPS paging/incident
  receiver after the exact final candidate and BSC deployment exist.
- Retain the actual receiver/on-call observation and bind its report to the final
  deployment manifest; the local report above cannot be promoted.
- Run the new uninterrupted 20-command `release:qa:run` for the final source.
- Supply funded BSC Testnet wallets/tBNB and complete deployment, verification
  and independent-wallet pilot tasks.
- Complete target TLS/WAF/trusted-proxy and KMS custody/recovery drills,
  KMS-encrypted off-host restore, independent Solidity/Web/API audits, real-user
  adoption/sign-offs and final release signatures/image provenance.
