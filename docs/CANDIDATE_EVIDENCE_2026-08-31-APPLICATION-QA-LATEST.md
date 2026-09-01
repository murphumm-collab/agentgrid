# AgentGrid historical 22-command QA evidence — locally verified source

Recorded 2026-09-01 (Asia/Shanghai). This record describes a local production-
mode QA run. It is not evidence of a BSC deployment, real-user adoption,
independent audit, production edge, or external KMS custody.

**Historical local status:** governed source froze after adding visible failure,
busy state and duplicate-safe boundaries to language, clipboard and Demo
mutations. This report binds source
`sha256:e2c88e37870b5bcf909b299d90239151cbb3f627005e330a82cecad8e7d30cac`
and unactivated candidate `unFAJP0q6TybW71fBjdHx`. Any later governed source
change immediately makes this evidence historical and requires a new fixed QA.

This report binds the frozen source after atomic registration recovery, the AI
dashboard method-schema correction and the OpenAPI 0.6.9 wallet-authentication
contract correction. It also binds the production-SDK/Demo-client separation and
the corrected on-chain integration example, wallet-verification abuse limits and
bounded transient security-state retention. OpenAPI 0.6.9, shared strict runtime
schemas and packaged production smoke now bind exact wallet-auth 400/401/403/429
semantics.
It additionally binds exact closed request contracts for all 19 advertised JSON
writes, complete evaluator/evidence/task-commitment signing fields and runtime
Schema execution at all 29 repository JSON decode sites.
It also binds OpenAPI 0.6.9 closed successful response envelopes for all 17
production SDK HTTP operations and 18 strict SDK runtime success schemas
including discovery. Packaged production smoke validates public response bodies
with those schemas and rejects response-contract drift.
It additionally binds V2 domain-separated evaluator/tester signatures and
canonical database retry responses; the real PostgreSQL smoke proves exact
retry recovery and conflicting-report rejection.
It also persists and recovers the exact V2 signing version and message from
PostgreSQL, verifies the stored signatures, and preserves legacy rows without a
fabricated preimage.
Production projection additionally re-parses report bodies, recomputes their
hashes, validates the configured TaskRegistry and recovers each signer. The real
PostgreSQL smoke corrupts a stored report and proves fail-closed rejection.
Tester projection also rebinds the signed work round, execution mode and exact
executor order to the current task projection; unit tests reject every mismatch
and the PostgreSQL smoke proves a stale work round fails closed.
AI dashboard schema 1.2 and OpenAPI 0.6.9 enumerate all 37 production operations
exactly once with deterministic operation IDs and workflow metadata. The source
also inventories all 55 actual API route operations and explicitly accounts for
18 non-protocol exclusions. Business-
adoption and wallet-notification workflows have strict bounded responses and
packaged-runtime authentication/cache evidence.
OpenAPI 0.6.9 additionally closes all 38 JSON 2xx responses across the complete
37-operation production inventory. The ten formerly status-only definition,
commitment, credential and hidden-test operations execute matching strict
server response schemas and private/no-store cache policy.
All 185 advertised 4xx/5xx statuses resolve to one closed bounded error
envelope, including an explicit safe 500 on every operation. Runtime validation
failures and the SDK execute the same strict contract; raw Zod and unclassified
exception messages are not exposed.
Completed-task pagination rejects unknown/duplicate parameters and stale
cursors with exact OpenAPI bounds. Hidden-test ciphertext upload uses only the
authenticated wallet session for publisher identity; no redundant
`x-publisher` contract remains.
Agent credential headers are now parsed before database lookup and `scrypt`.
OpenAPI 0.6.9 publishes exact Agent ID/API Key bounds, syntax and duplicate
policy; unit and packaged-runtime checks reject malformed, oversized and
duplicate-merged values with one authentication failure.
All 18 production dynamic-path operations execute shared UUID, positive
on-chain task ID, Agent ID or queue-job ID Schemas before downstream work.
OpenAPI and packaged smoke bind exact bounds, closed 400 envelopes, and the
hidden-test ciphertext PUT's complete 401/403/409/415 surface.
The hidden-test ciphertext route now uses one authenticated, manifest-bound
reader: empty body and malformed length are 400, exact-length mismatch is 409,
bounded overflow is 413, and unsupported media/encoding is 415. Unit and
packaged-runtime checks execute these stable machine errors.
All eleven Agent job kinds now map to one exact role and bounded payload through
the shared outbox/Redis/route/SDK Schema. OpenAPI publishes the same mappings;
invalid enqueue values and corrupt, oversized, ID- or role-mismatched stored
jobs are rejected or quarantined before Worker delivery.
Every kind also maps to one closed completion result. The queue validates the
result against the actual leased kind before releasing the lease, preserves the
lease after invalid output, accepts an exact same-Agent/result retry and rejects
owner/result conflicts. Durable completion records no longer contain Artifact
storage URLs or arbitrary extension values. The QA runner also derives isolated
test secret scrubbing from the canonical runtime-secret inventory.
Discovery schema 1.1 explicitly publishes the single-task, job-heartbeat and
job-completion templates used by the production SDK. A prototype-enumeration
regression binds every SDK workflow to discovery, and every discovered API
template to OpenAPI 0.6.9; packaged production smoke rejects drift.
The responsive navigation now retains a direct AI Dashboard link when the
desktop sidebar is hidden. Its explicit six-route list, six min-width-zero CSS
columns and Dashboard entry are protected by a source/CSS regression and the
production Web build.
Stake, task actions, business adoption, Agent registration/credential recovery
and AI definition review now carry structural success/error tones. Success uses
a polite status, failure an assertive alert, and one-time Agent API keys remain
outside automatically announced live regions; regressions reject localized-
message inspection.
Wallet-notification read writes now reject same-notification duplicate in-flight
requests, expose a disabled `aria-busy` state and visibly announce structural
success or failure. Immutable update and interaction regressions prevent silent
request failures from returning.
Language preference writes no longer refresh after a rejected response;
clipboard rejection becomes an accessible error; and Demo stake/faucet writes
share one busy and duplicate boundary. Source regressions bind all three flows.

## Immutable QA report

```text
report: <external-evidence-directory>/application-qa-20260901-1516.json
mode: 0600
bytes: 12228
SHA-256: c8daad4612fa58a86b08fd4ca8e6f14fcfaef174ab3438081ce883735ad1e816
started: 2026-09-01T07:16:46.244Z
completed: 2026-09-01T07:28:58.095Z
duration: 731851 ms
scope: agentgrid-production-application-qa
commands: 22
failed commands: 0
source SHA-256: sha256:e2c88e37870b5bcf909b299d90239151cbb3f627005e330a82cecad8e7d30cac
```

The runner used a 30-minute per-command hard timeout. Unit tests and production
dependency audit, type checking, lint, Solidity compilation/regression,
Worker/Compose/Web builds, file-secret, PostgreSQL session, Redis lease,
Artifact integrity, tester sandbox, key rotation, reorg, packaged Agent crash
delivery, monitoring acknowledgement, trusted proxy, KMS recovery, database
backup/restore and candidate snapshot all exited with code 0. The report stores
output hashes rather than local QA credentials.

## Bound candidate

```text
build ID: unFAJP0q6TybW71fBjdHx
directory: <local-releases>/agentgrid-20260901T072855Z-unFAJP0q
created: 2026-09-01T07:28:57.435Z
server SHA-256: 82adb99683348f2e8a036d12e953fd5b011a4925125e2487d318e2ab5337f0ae
payload SHA-256: sha256:e88563e5c91c01f6e5a1f52f695832f577a9dec80d7c449448f8023f8b82ff21
payload entries: 2580
payload bytes: 69565250
release-manifest SHA-256: sha256:651c3b7a5329b643b888e3357e223615d6608fe7bd692e34333892e591172679
```

The source tree and candidate payload were re-hashed independently after the QA
run, and the manifest file digest matched the report. The candidate directory is
mode 0555 and the manifest is mode 0444. The owner-only `.next/cache` path is the
sole declared mutable path. The candidate remains unactivated; this run did not
activate it, restart a displayed release or deploy it to a public endpoint.

## Launch boundary

The live BSC Testnet RPC reports chain ID 97, but the configured testnet deployer
`0x077A2e71d3EaB62F001Ad0Fff957f3627e6E78d1` has zero balance and no
`contracts/deployments/bsc-testnet.json` exists. Deployment, bytecode/wiring
verification, independently controlled pilot wallets, real business adoption,
dispute/maintenance/decay evidence, external audits and three-role final release
signatures remain open. The product must not be described as public production
until `pnpm release:production:check` exits 0.
