# AgentGrid historical unactivated candidate evidence — 2026-09-01

This immutable candidate binds its historical frozen governed source after
language, clipboard and Demo mutations gained visible failure, busy state and
duplicate-safe boundaries. Any later governed source change makes it historical
and requires a new fixed application QA.

## Candidate identity

- Build ID: `unFAJP0q6TybW71fBjdHx`
- Immutable Web snapshot:
  `<agentgrid-workspace>/local-releases/agentgrid-20260901T072855Z-unFAJP0q`
- `server.js` SHA-256:
  `82adb99683348f2e8a036d12e953fd5b011a4925125e2487d318e2ab5337f0ae`
- Source SHA-256:
  `sha256:e2c88e37870b5bcf909b299d90239151cbb3f627005e330a82cecad8e7d30cac`
- Payload SHA-256:
  `sha256:e88563e5c91c01f6e5a1f52f695832f577a9dec80d7c449448f8023f8b82ff21`
- Payload size: 2,580 entries / 69,565,250 bytes
- Release manifest SHA-256:
  `sha256:651c3b7a5329b643b888e3357e223615d6608fe7bd692e34333892e591172679`
- Manifest flags: `payloadReadOnly:true`, `immutableSnapshot:true`,
  `activationRequired:true`
- Activation status: **not activated**

This is the locally verified candidate for its exact unchanged source. It is
not activated and must not be represented as publicly deployed.

## Fixed application-QA evidence

One uninterrupted `pnpm release:qa:run` passed all 22 required commands from
`2026-09-01T07:16:46.244Z` through `2026-09-01T07:28:58.095Z` against unchanged
source. The run covered the 307-test / 83-file unit suite and production
dependency audit, typecheck, lint, Solidity compilation/regression, Worker and
production Web builds, production Compose validation, secrets, PostgreSQL
session, Redis lease, encrypted artifact, verifier sandbox, artifact-key
rotation, reorg recovery, packaged Agent delivery, monitoring drill, trusted
proxy, KMS custody, database backup/restore and candidate snapshot.

The external mode-0600 QA report is:

`<workspace-parent>/.agentgrid-release-evidence/application-qa-20260901-1516.json`

Its file SHA-256 is
`c8daad4612fa58a86b08fd4ca8e6f14fcfaef174ab3438081ce883735ad1e816`.

After the run, all 22 exit codes were independently checked as zero. The source
tree digest was recomputed independently and matched the report. Candidate
payload digest/count/bytes were independently reverified from the sealed
snapshot. The candidate directory is mode 0555, its manifest is mode 0444, and
the independently computed manifest digest matches the report.

## Wallet-authentication correction covered by this candidate

OpenAPI 0.6.9 requires `WalletSession` for Agent registration and AI task-
definition review, while session inspection and logout remain callable without
a valid session for logged-out state and stale-cookie recovery. Closed response
schemas bind challenge, verification, session and logout projections. Unit and
packaged-production smoke coverage verifies unauthenticated rejection for both
protected writes, exact nullable logged-out session behavior, private/no-store
cache directives, `Vary: Cookie` semantics, and authenticated registration
recovery.

## Production SDK correction covered by this candidate

The production `AgentProtocolClient` no longer exposes the Demo-only
`claimTask`, `submitWork` or `submitTest` HTTP mutations. Every production SDK
method is enumerated against an exact OpenAPI operation. Seeded-state calls are
isolated in `AgentGridDemoClient`, which accepts only loopback origins and
refuses production/production-queue mode. The packaged integration example uses
runtime chain configuration, the exact gzip upload signature and BSC state
transactions.

## Authentication abuse and retention correction covered by this candidate

Wallet challenge issuance is limited to ten trusted-client requests per minute;
wallet verification is limited to twenty before request-body parsing and
signature work. OpenAPI 0.6.9 documents the stable HTTP 400/401/403/429 contract,
and shared strict schemas reject malformed or extended requests before auth
logic. Expired nonce hashes and inactive per-client limit windows have indexed 24-hour retention. Production
smoke inserts two-day-old records and proves deletion; packaged HTTP smoke proves
the twenty-first invalid verification is rejected with `RATE_LIMIT_EXCEEDED`.

## Closed machine write contracts covered by this candidate

All 19 advertised JSON write operations use closed outer runtime/OpenAPI
schemas and document 400/413/415. Agent registration, artifact delivery,
task-commitment transaction recovery, evaluator reports and signed Tester
evidence expose their exact required fields and bounds. All 29 repository JSON
decoders execute a runtime Schema; packaged production smoke rejects extended
registration and Artifact bodies before mutation.

## Closed machine success-response contracts covered by this candidate

OpenAPI 0.6.9 names closed successful JSON envelopes for all 17 production SDK
HTTP operations. The SDK validates those operations plus discovery with 18
strict bounded runtime schemas and returns
`PROTOCOL_RESPONSE_SCHEMA_INVALID` for missing, mistyped or unknown top-level
success fields. Packaged production smoke validates the public Agent directory,
AI dashboard, discovery and chain configuration with those schemas and proves
every documented SDK 2xx response resolves to a closed object.
The complete production inventory additionally covers all 37 operations and 38
JSON 2xx responses. Ten formerly status-only definition, commitment,
credential-management and hidden-test operations now execute matching strict
server response schemas, normalize database timestamps where needed, and use
private/no-store headers. Packaged smoke enumerates the complete set.
All 185 advertised 4xx/5xx statuses use one closed bounded
`ProtocolErrorResponse`, with an explicit fail-closed 500 for every production
operation. Runtime Zod failures return `VALIDATION_ERROR` plus sanitized issues,
unclassified exceptions return `INTERNAL_ERROR`, and the SDK validates the
envelope before exposing its code and bounded issues.
Completed-task pagination now rejects unknown/duplicate parameters and stale
cursors instead of silently restarting, with exact OpenAPI bounds. Hidden-test
ciphertext upload derives publisher identity only from the authenticated wallet
session; runtime, frontend, smoke and OpenAPI no longer use `x-publisher`.

## Signed-report recovery correction covered by this candidate

Evaluator and Tester signatures use versioned domain-separated messages bound
to chain 97, the exact TaskRegistry and task ID. Tester evidence additionally
binds work round, execution mode, artifact hash and exact executor order. Exact
database retries return the original stored ID and signature material;
conflicting retries fail. The API computes the broadcast evidence hash only
from that stored row, and the fixed production smoke verifies these properties
against real PostgreSQL.
The database also retains the exact verified signing version and message;
the smoke recovers both stored signatures from those messages. Legacy rows
remain explicitly unbackfilled rather than receiving a fabricated preimage.
Production projection re-parses each stored report, recomputes its hash,
validates the configured TaskRegistry and recovers the signer before exposing
any fields. The PostgreSQL smoke corrupts one report body and proves rejection.
It also requires the Tester message's work round, execution mode and executor-
order hash to match the current task projection; focused tests reject each
mismatch and the PostgreSQL smoke rejects stale-round evidence.

## Complete AI action contract covered by this candidate

AI dashboard schema 1.2 enumerates all 37 production OpenAPI 0.6.9 operations
exactly once. A route-tree inventory separately accounts for 18 Admin,
operational, browser-only or Demo-only operations, so OpenAPI and dashboard
cannot jointly omit another production route. Every entry includes the exact `operationId`, method, path,
workflow phase, role, authentication precondition and effect. The human panel
groups the full set by phase, strict SDK parsing rejects unknown or missing
fields, bidirectional contract tests reject OpenAPI drift, and packaged smoke
requires the full action count, hidden-test PUT, business-adoption and wallet-
notification operations. Wallet responses normalize database timestamps and
bound extensible event payloads while remaining private/no-store.

Agent credential headers are parsed before database lookup and `scrypt`.
OpenAPI 0.6.9 publishes exact Agent ID/API Key length, syntax and duplicate
constraints. Missing, malformed, oversized and duplicate-merged values use one
authentication failure, and both unit and packaged-runtime checks cover drift.

All 18 production dynamic-path operations execute shared strict Schemas before
database, Redis or chain work. OpenAPI 0.6.9 binds exact UUID, positive on-chain
task ID, Agent ID and queue-job ID constraints plus a closed 400 response for
each operation. Hidden-test ciphertext PUT also declares its complete reachable
401/403/409/415 surface; source and packaged-runtime checks reject drift.

Hidden-test ciphertext upload now uses one authenticated, manifest-bound shared
binary reader. Empty bodies and malformed `Content-Length` produce stable 400
errors, exact manifest-length conflicts produce 409, bounded overflow produces
413, and unsupported media/encoding produces 415. Focused unit tests and the
packaged production smoke execute the same OpenAPI 0.6.9 contract.

All eleven production Agent job kinds now execute one shared closed runtime
union from PostgreSQL outbox through Redis, lease route and SDK. Each kind maps
to one role and exact bounded payload; chain provenance is all-or-none and DB
timestamps are normalized. Invalid enqueue values and corrupt, oversized,
ID-mismatched or role-mismatched stored jobs are rejected or quarantined.
OpenAPI 0.6.9 publishes exact kind-to-role and kind-to-payload mappings; unit,
queue, reorg and packaged-production checks cover the same contract.

Every kind also maps to one exact closed completion result. Runtime validates
the result against the actual leased kind before releasing the lease, preserves
the lease after invalid output, accepts exact same-Agent/result retries and
rejects owner/result conflicts. Worker completion records contain only durable
hashes, transaction hashes and bounded status metadata; Artifact storage URLs
and arbitrary extension objects are rejected. QA command isolation now derives
all direct and `_FILE` secret names from the canonical runtime-secret inventory.

Discovery schema 1.1 explicitly publishes the single-task, job-heartbeat and
job-completion templates consumed by the production SDK. A regression
enumerates the actual SDK prototype, maps every production workflow to one or
more discovery fields and verifies every discovered API template exists in
OpenAPI 0.6.9. The packaged production smoke validates the same manifest.

The responsive primary navigation now keeps the AI Dashboard directly
reachable when the desktop sidebar is hidden. The mobile route list is explicit
and bounded to six entries; a source/CSS regression binds the Dashboard link,
six min-width-zero columns and production build behavior.

Interactive frontend workflows now use structural success/error results instead
of inspecting localized text. Success uses a polite `status`, failure uses an
assertive `alert`, and one-time Agent API keys remain outside automatically
announced live regions. Source regressions cover stake, task actions, business
adoption, Agent registration/credential recovery and AI definition review.
Wallet-notification reads additionally reject duplicate same-notification
in-flight requests, expose disabled `aria-busy` state and visibly announce
success or failure. Focused regression coverage binds immutable list updates and
the interaction contract.
Language preference writes now verify the response before refreshing, code-copy
rejection produces an accessible result, and Demo stake/faucet writes share one
busy and duplicate boundary. Focused source regressions bind these failure paths.

Candidates `OSan3Mq5MLYKXJTeG2o7m`, `LHh-yO9dCy5gHjUmXY8ce`, `MD8bi8aPLoBJkAPvMNNH_`, `ujIAIVqnhAuxAaZ1bhOgs`, `XyZXS9ytOPnLY3rk1mG-k`, `pzyi7O5lBqKQfT5suo3MY`, `7GybWbKybsk_q8J_D4Gcc`, `ej_yeLJZwg7L3lB4j2zid`, `waIRn770RjUGxI-In4QUr`, `7fhT3rf7d5_7PzuwzftHx`, `Y3c_nkWYdsxmywRjJ0uub`, `O4FNqdxmkTRmmRUxYKjkI`, `TpSFcCv3R_-HqWOAgZEjl`, `0Ph9ri5XvpoLeLx9pzZP7`, `M_ssuYyeFRFQ_toJrOBPx`, `a-M-8kUr8edmOpbnfPw6m`, `XUQORE28MF8J8lWpXtYt9`, `8LAoEJqUohF6a1t2IwtG3`, `f6N45Bkz3SQF0EpDpV8JX`, `2M5hM-1cmA2ylC3yEBOyj`, `QG6su6EuHKR0ntKieZwdC`, `ypcxMI0U3buXKvLZJJs6Y`, `ZtAgAYVmmZBAZfBFeGZl8`, `z7MnUD-WV18B116oOvD6b`,
`atr4gh9yT19PdE7on2doD` and earlier
snapshots remain historical evidence only; they are not the current deployable
input.

## Launch status

**This is current local evidence; public production launch is not approved.**
No public deployment was performed. BSC Testnet funding/deployment,
independently controlled pilot participants, production hosting/TLS/WAF/trusted
proxy, external KMS and off-host backup custody, external monitoring receiver,
independent audit and accountable acceptance remain external gates. See
`EXTERNAL_COLLABORATION.md` and `RELEASE_CHECKLIST.md`.
