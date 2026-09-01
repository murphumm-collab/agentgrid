# AgentGrid candidate security review — 2026-08-31

## Executive summary

This is an internal, repository-grounded review of its historical candidate source;
it is not an independent audit and does not approve public launch. No unresolved
critical issue was identified. Two high-risk implementation defects found during
this development cycle—execution of orphaned chain-event jobs after a reorg and
unrestricted forwarding of decrypted collaboration artifacts to an AI provider—
are fixed and covered by focused tests/smoke exercises. A backup credential leak
through process arguments and deterministic reward-padding exposure were also
reduced in the candidate.

Evidence status update: the fixed 22-command QA completed against its then-
governed source and is bound to historical immutable candidate `pzyi7O5lBqKQfT5suo3MY`
and source SHA-256
`sha256:df09adbb03c51a360c3f17600a7bc697b58768a84714f7d76a0eed86f364c60c`.
Independent digest and permission verification passed. Governed source work has
since resumed for the Agent job-completion result contract, so that evidence no
longer closes the current-source QA gate; public launch remains gated as
described below.

Historical local evidence update: the frozen discovery schema 1.1 / OpenAPI 0.6.9
source, mobile AI Dashboard navigation and accessible duplicate-safe frontend
mutations passed all 22 commands from `2026-09-01T07:16:46.244Z` through
`2026-09-01T07:28:58.095Z`. It is bound to source
`sha256:e2c88e37870b5bcf909b299d90239151cbb3f627005e330a82cecad8e7d30cac`
and immutable unactivated candidate `unFAJP0q6TybW71fBjdHx`. Independent report,
source, payload, server, manifest, safe-link and permission verification passed.
This closed that source's local QA/candidate gate only; public launch remains
externally gated.

Public launch remains gated by external secret/KMS custody, TLS/WAF/rate limits,
off-host backup and alert receiver configuration, an independent Solidity and
Web/API audit, BSC Testnet deployment evidence, and independently operated pilot
wallets. The production Compose file binds the Web service only to
`127.0.0.1:3000`; it must remain behind that boundary until these gates close.

## Findings

### AG-SEC-001 — Orphaned jobs could mutate state after a chain reorganization

- **Severity:** High
- **Status:** Fixed in candidate
- **Location:** `src/lib/store-postgres.ts:324-332`,
  `src/lib/store-postgres.ts:542-593`, `src/lib/agent-queue.ts:27-71`,
  `src/lib/agent-queue.ts:111-154`
- **Evidence:** Every event-generated job now carries chain ID, transaction hash,
  log index, and block number. Rewind removes orphan outbox rows. Redis verifies
  the exact canonical event at lease, heartbeat, and completion; an in-flight
  orphan is completed as `CHAIN_EVENT_REWOUND` before any further mutation.
  `pnpm reorg:queue:smoke` exercises queued orphan discard, in-flight cancellation,
  replacement-block execution, and mismatched-log rejection against PostgreSQL
  and Redis.
- **Impact before fix:** A task ID reused after a reorg could receive work or a
  transaction that originated from a different orphaned event.
- **Fix:** Exact provenance plus canonicality checks at every worker mutation
  boundary.
- **Residual mitigation:** Production indexer alerting must be configured and the
  smoke test must remain a release gate.
- **False-positive notes:** None; this was a concrete crash/reorg window.

### AG-SEC-002 — Decrypted collaboration work could leave the approved trust boundary

- **Severity:** High
- **Status:** Fixed in candidate; provider governance remains external
- **Location:** `src/lib/ai-provider-policy.ts:1-12`,
  `agents/simple-ai-runner.ts:29-63`, `agents/simple-ai-runner.ts:114-124`
- **Evidence:** Production agents require an exact `AI_ALLOWED_ORIGINS` match,
  reject remote cleartext HTTP and URL-embedded credentials, and no longer include
  a provider response body in error messages. AI calls reject redirects, have
  finite timeouts and stream responses through hard byte limits; decrypted team
  contributions are downloaded only up to their committed ciphertext size and
  must match that size before decryption. Tests cover the shared bounded reader,
  missing/wrong origins, cleartext remote endpoints, embedded credentials, and
  the localhost exception.
- **Impact before fix:** A collaboration lead decrypts all committed team
  contributions for assembly; a misconfigured endpoint could disclose proprietary
  source and task data.
- **Fix:** Fail-closed provider allowlist and transport validation.
- **Residual mitigation:** Confidential tasks should use an approved self-hosted
  endpoint; the operator must verify contractual/data-residency controls and limit
  provider retention.
- **False-positive notes:** A tester and collaboration lead necessarily see the
  artifacts in the current trust model; eliminating that trust requires TEE/MPC or
  threshold computation and is not claimed by this release.

### AG-SEC-003 — Target private-key and master-key custody is not yet verified

- **Severity:** High
- **Status:** Code path fixed; target custody/recovery remains an open gate
- **Location:** `src/lib/secrets.ts:32-98`,
  `docker-compose.production.yml:1-22`,
  `docker-compose.production.yml:69-78`,
  `docker-compose.production.yml:188-221`,
  `src/app/api/health/ready/route.ts:18-31`,
  `src/lib/kms-custody-evidence.ts`,
  `scripts/kms-custody-verify.ts`,
  `scripts/kms-custody-smoke.ts`
- **Evidence:** Production Compose now sets `REQUIRE_FILE_SECRETS=true`, mounts 15
  external role-specific Secrets, and contains no direct database, master/API key,
  alert HMAC key, operator key, or evaluator wallet variable. The reader rejects
  direct-plus-file conflicts, relative/non-regular/unsafe files, NUL/empty/oversized
  values and placeholders without copying values into `process.env`. Readiness
  fails unless all Web secrets are file-backed. `pnpm production:secrets:smoke`
  validates the fully expanded 13-service topology and starts the bundled
  Migration Worker using only temporary 0400 files. The delivery smoke also
  requires `fileBackedSecrets:true` before exercising Agent/Artifact APIs. The
  strict recovery verifier binds four critical assets to the exact candidate and
  deployment, checks 0400 recovery inputs, AES/wallet round trips, custody policy
  and provider audit hashes, and emits only mode-0600 hashed evidence. Its local
  smoke passes and is deliberately rejected as production evidence. No target
  provider policy/audit export or real isolated recovery observation exists yet.
- **Impact:** Host or container-environment compromise can expose deployer,
  coordinator, evaluator, and artifact-release authority.
- **Required fix:** Bind the declared external Secret names to a real KMS/secret
  manager, use short-lived workload identity where possible, record access policy,
  and exercise recovery/rotation before launch.
- **Interim mitigation:** Preserve file-only enforcement, separate operator and
  evaluator mounts, testnet-only wallets, localhost binding and read-only containers.
- **False-positive notes:** The repository proves the injection/recovery verifier
  boundary and rejects plaintext Compose environment secrets. Local recovery is
  not evidence of who controls the target secret store; that remains an external
  observation reviewed by the release signers.

### AG-SEC-004 — Independent contract and Web/API review is missing

- **Severity:** High
- **Status:** Open production gate
- **Location:** `docs/RELEASE_CHECKLIST.md:83-84`,
  `docs/PRODUCTION_RUNBOOK.md:293-304`
- **Evidence:** Local contract and application tests exist, but there is no signed
  third-party report, report hash, reviewer identity, or closure evidence.
- **Impact:** Economic, authorization, cryptographic, and state-machine defects may
  survive an internal review despite green tests.
- **Required fix:** Independent Solidity plus Web/API assessment, threat-model
  review, closure of every high/critical issue, and archived report hash.
- **Interim mitigation:** Do not expose the service publicly or fund production
  reserves.
- **False-positive notes:** Nine on-chain lifecycle/adversarial tests are useful
  regression evidence, not an audit substitute.

### AG-SEC-005 — Database password was exposed in the backup process argument list

- **Severity:** Medium
- **Status:** Fixed in candidate
- **Location:** `scripts/backup.ts:7-30`, `scripts/backup.test.ts`
- **Evidence:** The direct backup path now strips the password from the PostgreSQL
  URL passed to `pg_dump`, validates the URL scheme, and supplies the decoded
  password only in the child environment. Tests prove connection options survive
  while the process argument contains no password.
- **Impact before fix:** A local user/process able to inspect process arguments
  could recover the database password while a backup was running.
- **Fix:** Sanitized DSN plus child-only `PGPASSWORD`.
- **Residual mitigation:** External database credentials should be short-lived and
  injected from the secret manager described in AG-SEC-003.
- **False-positive notes:** Process-environment access by the same privileged host
  account remains possible; this fix removes the broader command-line exposure.

### AG-SEC-006 — Deterministic work weights can be manipulated by artifact padding

- **Severity:** Medium
- **Status:** Mitigated; semantic proof remains impossible on-chain
- **Location:** `src/lib/contribution-weights.ts:20-87`,
  `src/lib/contribution-weights.test.ts:28-35`,
  `src/app/api/evidence/route.ts:18-23`,
  `src/app/api/evidence/route.ts:49-54`
- **Evidence:** Formula `incorporated-bytes-v2` caps credit at 64 KiB per file and
  512 KiB per contributor, splits identical claims, signs the versioned report,
  and binds contributor order/weights to the executor vector. The contract checks
  vector length and 10,000-bps total.
- **Impact:** Without caps, large comments/fixtures could dominate payout while
  adding little business value.
- **Fix:** Per-file/per-contributor caps, version binding, fixed executor order, and
  independent tester evidence.
- **Residual mitigation:** Human/publisher acceptance and dispute review remain
  necessary; byte incorporation is a deterministic payout proxy, not proof of
  business value.
- **False-positive notes:** The equal split on zero exact matches is deliberate and
  should be disclosed to participants.

### AG-SEC-007 — Public ingress controls are externally unverified

- **Severity:** Medium
- **Status:** Application body/proxy controls fixed; external production gate remains open
- **Location:** `docker-compose.production.yml:58-63`,
  `src/lib/request-body.ts`, `src/lib/request-body.test.ts`,
  `scripts/agent-delivery-smoke.ts`, `scripts/trusted-proxy-smoke.ts`,
  `scripts/edge-security-verify.ts`, `src/lib/security.ts`, `src/middleware.ts`,
  `next.config.ts`
- **Evidence:** All 25 JSON write routes use the same streaming decoder. It
  enforces media type, identity encoding, fatal UTF-8 and actual streamed-byte
  limits, so omitting or forging `Content-Length` does not bypass the cap. Unit
  tests cover declared and chunked oversize bodies; the delivery smoke verifies
  real Next.js responses of 415, 400 and 413. Signed evidence has a 256 KiB cap,
  job completion 128 KiB, and other JSON routes 64 KiB. The application also
  supplies CSP/security/cache headers and Compose binds only to localhost.
  `TRUST_PROXY=true` now requires a dedicated file-only proxy credential;
  forwarding identity is accepted only after constant-time authentication and
  only as one syntactically valid IP. A real-process smoke proves spoof headers
  are overwritten and direct requests without the proxy credential fail. The
  external verifier and release schema require valid TLS/HSTS/redirect/security
  headers, TRACE/oversize/rate-limit WAF observations, an edge marker, spoof
  overwrite and network-blocked/403 origin. No target domain/WAF observation is
  recorded yet.
- **Impact:** Premature public exposure could still enable distributed request
  flooding, IP-spoofing mistakes, or transport downgrade even though individual
  JSON request memory is bounded inside the application.
- **Required fix:** Deploy and run `pnpm ops:edge:verify` from an independent
  external vantage; keep `TRUST_PROXY=false` until the exact proxy topology and
  target report pass.
- **Interim mitigation:** Preserve the current localhost-only bind.
- **False-positive notes:** This is not a claim that port 3000 is currently public;
  the binding demonstrates the opposite.

### AG-SEC-008 — Off-host recovery and alert delivery are implemented but unconfigured

- **Severity:** Medium
- **Status:** Code path hardened; target observation remains an open production gate
- **Location:** `scripts/backup.ts`, `scripts/backup-offsite-verify.ts`,
  `src/lib/operational-monitor.ts`, `scripts/monitoring-alert-drill.ts`,
  `docs/RELEASE_CHECKLIST.md:80-82`
- **Evidence:** Candidate code supports KMS-encrypted S3 copies, checksum metadata,
  atomic success manifests and streamed restore verification of eleven lifecycle
  tables. Production Compose now passes the target configuration and mounts two
  dedicated file-only backup credentials. The off-host verifier downloads the
  remote manifest and dump again, verifies bytes/length/metadata/SHA-256, restores
  the downloaded dump and removes the disposable database. A local MinIO path
  exercise passed and is explicitly labelled/rejected as production evidence;
  upload failure was proven not to set `offHost`. Monitoring uses HTTPS,
  HMAC-SHA256, redirect rejection and a ten-second timeout. A delivery is no
  longer considered successful from HTTP 2xx alone: the receiver must return a
  bounded strict acknowledgement matching the UUID, event kind and exact request
  SHA-256. The local drill exercised alert, reminder and recovery with all three
  HMACs and acknowledgements and emits a candidate/deployment-bound mode-0600
  report that the release gate rejects as `local-smoke`. No target bucket, KMS
  key, production alert receiver, scheduled restore drill, or production
  acknowledgement trace exists.
- **Impact:** A host failure or silent indexer/queue outage could remain unrecovered
  or unnoticed.
- **Required fix:** Configure target services and archive one successful off-host
  restore plus alert/recovery delivery trace.
- **Interim mitigation:** Local checksum/restore, monitor unit tests and the
  acknowledged three-event monitoring smoke remain mandatory candidate gates.
- **False-positive notes:** Passing local smoke tests proves code paths, not target
  operational readiness.

### AG-SEC-009 — Related-wallet/Sybil relationships cannot be proven from addresses alone

- **Severity:** Medium
- **Status:** Accepted protocol limitation pending pilot evidence
- **Location:** `docs/RELEASE_CHECKLIST.md:46-68`,
  `docs/RELEASE_CHECKLIST.md:107-110`
- **Evidence:** Random future-block selection, role exclusions, minimum staking,
  evaluator/tester capabilities, and repeated-combination reward decay raise the
  cost of collusion. They do not establish beneficial ownership of wallets.
- **Impact:** One operator may create publisher/executor/tester identities and
  attempt to farm rewards or bias acceptance.
- **Required fix:** Define pilot allowlisting/reputation and anomaly thresholds;
  for permissionless launch, add identity/attestation or stake/slashing controls
  proportionate to the desired resistance.
- **Interim mitigation:** Use independently controlled, documented wallets in the
  testnet pilot and review repeated graph combinations.
- **False-positive notes:** On-chain address analysis can indicate relationships
  but cannot reliably prove common control.

### AG-SEC-010 — Browser wallet configuration was fixed at image build time

- **Severity:** High
- **Status:** Fixed in candidate
- **Location:** `src/app/api/chain/config/route.ts`,
  `src/lib/browser-chain-config.ts`, `src/lib/chain-actions.ts`,
  `src/components/wallet-connect.tsx`, `scripts/agent-delivery-smoke.ts`
- **Evidence:** Wallet actions no longer read compiled `NEXT_PUBLIC_*` contract
  constants. A strict runtime endpoint returns BSC Testnet chain ID, the configured
  confirmation count, checksummed contract addresses and optional public
  WalletConnect project ID. All wallet writes use this configuration and wait the
  same five confirmations as the indexer/workers. The production-mode delivery
  smoke starts a compiled standalone Web server with only server-side runtime
  addresses and verifies all five values, the WalletConnect ID and confirmation
  policy. Unit tests reject wrong networks, invalid addresses and invalid counts.
- **Impact before fix:** A production image built before deployment addresses were
  known could ship an empty/stale browser bundle: staking, Agent registration,
  task publication, review and claims would fail or target the wrong contract,
  while two-confirmation UI success disagreed with the five-confirmation indexer.
- **Fix:** Runtime public configuration with strict validation and a single
  confirmation policy.
- **Residual mitigation:** `/api/health/ready` must remain closed until deployed
  bytecode exists at every configured address; deployment verification and real
  wallet pilots are still mandatory.
- **False-positive notes:** Contract addresses and WalletConnect project IDs are
  public configuration, not secrets.

### AG-SEC-011 — Non-empty deployed code was accepted without exact source binding

- **Severity:** High
- **Status:** Fixed in candidate; real deployment evidence remains open
- **Location:** `contracts/scripts/compiler.ts`,
  `contracts/scripts/bytecode-verification.ts`,
  `contracts/scripts/verify-deployment.ts`,
  `contracts/scripts/pilot-preflight.ts`,
  `src/lib/runtime-contract-verification.ts`,
  `src/app/api/health/ready/route.ts`
- **Evidence:** The compiler now preserves every Solidity immutable reference.
  Deployment verification and pilot preflight normalize only those declared byte
  ranges, then require the remaining on-chain runtime bytecode to equal current
  compiler output exactly. Focused tests prove immutable values may differ while
  any other opcode change fails. Contract lifecycle setup verifies the five core
  locally deployed runtimes through the same function. The production readiness
  endpoint uses a build-time manifest to verify all six deployed contracts,
  including the dispute resolver; the delivery smoke proves one changed opcode
  closes readiness with HTTP 503 and restoration reopens it. Manifests include
  solc version, immutable references and normalized runtime hashes.
- **Impact before fix:** Any non-empty contract at a manifest address could pass
  the bytecode presence check, including an older or unrelated implementation
  with different authorization/economic behavior.
- **Fix:** Exact source-to-runtime binding with immutable-slot normalization.
- **Residual mitigation:** Archive the deployment manifest, compiler lockfile and
  explorer/source verification; an independent audit is still mandatory.
- **False-positive notes:** Constructor-set immutable values necessarily differ
  from compiler placeholders and are intentionally the only normalized bytes.

### AG-SEC-012 — Maintenance replacement could deadlock and reward inactive actors

- **Severity:** High
- **Status:** Fixed in candidate
- **Location:** `contracts/src/TaskRegistry.sol`,
  `contracts/src/RewardVault.sol`, `contracts/test/protocol-chain.test.ts`,
  `src/lib/chain-projection.ts`
- **Evidence:** A failed verification advances the task to `Correction`. The
  any caller can execute the objective timeout for an executor who has not committed in the current work
  round, and a replacement execution-capable Agent may now claim directly from
  `Correction`. After the replacement artifact passes a newly selected tester,
  the Vault records a checkpoint-specific executor vector and tester for the
  current and later unclaimed maintenance tranches. Checkpoint 0 and already
  claimed tranches remain bound to their original participants. The lifecycle
  regression proves the original executor and tester receive only delivery,
  while the replacement executor and replacement tester receive days 7/30/90.
- **Impact before fix:** An eviction during correction produced a general
  replacement job, but `claimTask` rejected `Correction`, leaving the task
  permanently stuck. Even if repair was completed by the original team, the
  immutable Grant always paid its first executor/tester set; a future replacement
  would perform maintenance without receiving the corresponding reward.
- **Fix:** Allow bounded replacement claims during correction and use immutable,
  checkpoint-specific participant overrides only after independent repair
  evidence succeeds.
- **Residual mitigation:** Semantic contribution weights remain tester-signed
  evidence rather than an on-chain proof of business value; disputes and pilot
  observation are still required.
- **False-positive notes:** This was a concrete state-machine and payout-path
  mismatch, not a theoretical availability concern.

### AG-SEC-013 — Acceptance did not prove downstream business adoption

- **Severity:** Medium
- **Status:** Fixed in candidate; real-user attestation remains an open pilot gate
- **Location:** `src/lib/business-adoption.ts`,
  `src/app/api/tasks/[id]/business-adoption/route.ts`,
  `src/components/business-adoption-form.tsx`, `src/lib/store-postgres.ts`
- **Evidence:** An attestation is accepted only from the authenticated publisher
  wallet after an accepted chain state and an exact audited artifact release.
  Its EIP-191 signature binds chain ID, task, publisher, release UUID, final
  plaintext SHA-256, release time, workflow type, external evidence SHA-256 and
  adoption time. PostgreSQL permits one immutable record per task-and-final-
  artifact pair, retaining old maintenance-version history without allowing an
  overwrite. Only a record matching the current canonical artifact is surfaced. The raw
  deployment URL, customer identifier or ticket is hashed in the browser and is
  never submitted. Tests reject early claims, wrong wallets, substituted tasks,
  releases and artifacts, replayed signatures, and future timestamps.
- **Impact before fix:** A completed task proved technical acceptance and key
  release but could still be counted as useful work without evidence that anyone
  deployed, delivered or used it.
- **Fix:** Publisher-signed, release-bound, immutable downstream-adoption record.
- **Residual mitigation:** This is deliberately a publisher self-attestation,
  matching the product rule that the user defines real use. It does not prove
  revenue, customer identity or independent adoption. The public-production gate
  still requires a real publisher to sign one and retain the preimage externally.
- **False-positive notes:** The control proves integrity and attribution of the
  claim, not the truth of the off-platform business event.

### AG-SEC-014 — Manual pilot sign-off could be replayed or satisfied with unrelated history

- **Severity:** High
- **Status:** Fixed in candidate; genuine external signers and pilot activity remain open launch gates
- **Location:** `src/lib/pilot-signoff.ts`, `src/lib/pilot-qualification.ts`,
  `src/lib/pilot-qualification-service.ts`,
  `src/app/api/admin/pilot-readiness/route.ts`
- **Evidence:** The private qualification report re-verifies every immutable
  publisher-adoption signature and row binding, scopes canonical lifecycle events
  to the signed task set, and requires three useful adopted tasks, distinct
  publisher and Agent wallets, role separation, both execution modes, quorum
  dispute resolution, ordered day 7/30/90 maintenance and an observed decayed
  reward. Six distinct signer wallets produce EIP-191 attestations that bind chain ID 97, pilot ID, exact deployment
  manifest SHA-256, normalized task-set hash, role, reviewer subjects, external
  evidence hash and timestamp. Tests reject deployment/task/subject substitution,
  duplicate tasks, self-review, insufficient review scope, duplicate or cross-role
  signer entries, future timestamps, invalid adoption rows and historic events outside
  the signed task set.
- **Impact before fix:** Operators could manually check launch rows or reuse
  technically valid historic events and signatures from a different pilot task
  set, creating a false claim of real-business readiness.
- **Fix:** Fail-closed, deployment- and task-set-bound machine qualification gate
  with independently signed review and operational-owner attestations.
- **Residual mitigation:** Distinct addresses and signed off-platform reviews do
  not cryptographically prove independent human control or business truth. Final
  launch still requires real users, retained evidence preimages and independent
  audit review.
- **False-positive notes:** Local fixtures only validate gate behavior; they are
  explicitly not real pilot evidence.

### AG-SEC-015 — Deployment and final launch evidence could report success without a reproducible transaction trail

- **Severity:** High
- **Status:** Fixed in candidate; external evidence remains an open launch gate
- **Location:** `contracts/scripts/deploy.ts`,
  `contracts/scripts/deployment-run-state.ts`,
  `contracts/scripts/verify-deployment.ts`,
  `src/lib/production-release-evidence.ts`,
  `src/lib/production-release-service.ts`
- **Evidence:** The broadcaster now requires an exact acknowledgement, persists
  every transaction hash in a mode-0600 configuration-bound resume file before
  confirmation, rejects an existing final manifest and records the exact 15-step
  transaction set. The verifier checks all receipts and five-confirmation depth,
  deployment addresses, exact runtime code, wiring, roles, ownership and reserve.
  A separate production-release gate hashes 12 launch preimages and requires
  three distinct EIP-191 owner/security/operations signatures bound to chain 97,
  candidate, deployment and pilot scope. Adversarial tests reject substituted
  evidence, duplicate signers, stale timestamps, path traversal, symlinks and
  writable evidence files.
- **Impact before fix:** A crashed deployment could be rerun ambiguously, the old
  top-level-await verifier was not executable in the configured runtime, and a
  manually assembled checklist could omit transaction or external-control
  evidence while still being described as ready.
- **Fix:** Resumable transaction journal, receipt-bound verification and one
  fail-closed signed release-evidence gate.
- **Residual mitigation:** Real BSC receipts, image-registry provenance, external
  audit contents and infrastructure drill truth cannot be manufactured by local
  tests. `release:production:check` must remain red until those independent
  preimages exist and reviewers sign them.
- **False-positive notes:** Example drafts and local cryptographic fixtures prove
  the gate behavior only; they are deliberately not launch evidence.

### AG-SEC-016 — AI completion reviews were advisory and client-forgeable

- **Severity:** High
- **Status:** Fixed in candidate
- **Location:** `src/app/api/task-spec-assistant/route.ts`,
  `src/lib/store-postgres.ts`, `src/components/new-task-form.tsx`
- **Evidence:** Production requires valid structured reports from both external
  requirements-writer and validation-critic roles. A ready result creates an expiring,
  publisher-bound server record containing the reviewed task hash, exact
  definition hash, reviewer identities/report hashes and assessment. Production
  commitment creation atomically verifies the credential, exact title, business
  outcome, category and completion definition, consumes it once, and binds its
  UUID into the on-chain task specification. Changed, expired, cross-publisher
  and replayed credentials fail before the hidden-test manifest is consumed.
  The review table is included in backup/restore verification.
- **Impact before fix:** A publisher could skip the AI gate or submit arbitrary
  `aiReviews` metadata while still producing a syntactically testable task.
- **Fix:** Mandatory server-issued, exact-definition-bound, one-time publication
  credential in production.
- **Residual mitigation:** AI review improves testability but cannot supply
  missing business facts or prove that an off-platform outcome is truthful;
  random evaluators, independent testers and publisher adoption evidence remain
  separate gates.
- **False-positive notes:** Demo mode remains intentionally non-authoritative and
  does not issue a production publication credential.

### AG-SEC-017 — Tester and publisher artifact downloads allocated unbounded responses

- **Severity:** High
- **Status:** Fixed in candidate
- **Location:** `src/lib/sandbox.ts`, `src/lib/artifact-delivery.ts`,
  `src/app/api/artifacts/tasks/[taskId]/release/route.ts`
- **Evidence:** Tester artifacts, hidden tests and publisher releases now reject
  redirects, use 30-second timeouts, enforce the protocol's 100 MiB ceiling and
  stream no more than the manifest `sizeBytes`. Short and long responses are
  rejected before AES-GCM decryption. The publisher release API now returns the
  exact ciphertext size already required by OpenAPI. Focused tests cover exact,
  chunked-oversized and truncated responses.
- **Impact before fix:** A compromised or malfunctioning signed-download origin
  could make a Tester Worker or publisher browser buffer an unbounded response;
  the publisher response also omitted the size needed to detect truncation before
  decryption.
- **Fix:** Shared bounded streaming reader plus exact manifest-length binding at
  every encrypted download trust boundary.
- **Residual mitigation:** Production object storage, edge limits and signed-URL
  policy remain externally operated controls; clients still need enough memory
  for the permitted artifact and decrypted archive.
- **False-positive notes:** The stored manifests already capped ciphertext at
  100 MiB (10 MiB for hidden tests), but consumers did not enforce those committed
  sizes while reading the response.

### AG-SEC-018 — Runtime and deployment RPC transports allowed unsafe endpoint semantics

- **Severity:** High
- **Status:** Fixed in candidate
- **Location:** `src/lib/bsc-rpc.ts`, `src/lib/env.ts`, Web/Worker chain clients,
  `contracts/scripts/pilot-policy.ts`, deployment and Pilot scripts
- **Evidence:** Production is pinned to BSC Testnet chain ID 97. All runtime
  Web/Worker clients reject remote cleartext HTTP, embedded URL credentials,
  fragments and redirects; use finite timeout/retries; and cap JSON-RPC responses
  at 1 MiB. The direct readiness call also performs fatal UTF-8, bounded streaming
  and stable JSON validation. Deployment, verification and Pilot transports use
  the stricter public HTTPS/private-network policy with the same transport caps.
  Focused tests cover wrong chain configuration, unsafe URLs, redirect settings
  and an oversized chunked response.
- **Impact before fix:** A configuration error could label another chain as BSC
  Testnet, send RPC traffic over remote cleartext HTTP, follow a redirect, or let
  the readiness endpoint buffer an unbounded provider response.
- **Fix:** Two centralized RPC policies: a loopback-capable bounded runtime
  transport for isolated smoke tests, and a public-only bounded broadcast/Pilot
  transport.
- **Residual mitigation:** Production RPC account governance, availability and
  provider terms remain external operational controls. Pilot preflight still
  resolves DNS and rejects any private result before live activity.
- **False-positive notes:** Viem already had a larger default response cap and
  timeout; the defect was inconsistent endpoint/redirect policy, wrong-chain
  configurability and the direct readiness fetch bypass.

### AG-SEC-019 — Production authentication silently defaulted to a local or non-canonical origin

- **Severity:** High
- **Status:** Fixed in candidate; public domain verification remains external
- **Location:** `src/lib/auth-origin.ts`, `src/lib/env.ts`,
  `docker-compose.production.yml`, `src/lib/auth.ts`
- **Evidence:** Production now requires an explicit `AUTH_ORIGIN`, normalizes a
  trailing slash to the exact URL origin, requires remote HTTPS, and rejects URL
  credentials, paths, queries and fragments. The same normalized value binds the
  SIWE URI/domain and every browser origin check. Compose fails closed when the
  variable is absent, the expanded Secret smoke checks every application service,
  and release QA validates the value before its first command. Focused tests cover
  normalization and each rejected URL class.
- **Impact before fix:** A public deployment could silently issue localhost SIWE
  messages or accept a path-bearing value that no browser `Origin` header could
  equal, breaking authentication/CSRF enforcement and confusing wallet users.
- **Fix:** One explicit canonical authentication origin across runtime, Compose,
  QA and operator documentation.
- **Residual mitigation:** DNS, TLS certificate and edge routing truth must be
  verified externally against this configured origin before public launch.
- **False-positive notes:** The loopback HTTP exception is retained only because
  isolated production-mode smoke servers need a real browser-origin contract.

### AG-SEC-020 — Sensitive API responses lacked a default anti-cache boundary

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** `src/middleware.ts`, `src/lib/http.ts`
- **Evidence:** Edge middleware now applies `private, no-store, max-age=0`,
  `Pragma: no-cache` and an expired timestamp to every API outside the explicit
  `/api/public/*` safe-projection namespace. The shared error mapper applies the
  same policy, including failures returned by public routes. Focused tests cover
  authentication nonce, Agent registration, signed artifact upload, admin
  metrics, readiness and the public namespace exception.
- **Impact before fix:** A browser, reverse proxy or misconfigured CDN could
  retain one-time credentials, signed object URLs, hidden-test metadata or
  authenticated operational data when the individual route omitted a header.
- **Fix:** Deny caching centrally and require public caching to opt in only under
  the projection-only namespace.
- **Residual mitigation:** The production edge configuration remains an external
  control and must preserve rather than weaken application cache headers.
- **False-positive notes:** Public dashboard/statistics/completed-task routes are
  permitted to request a short public cache because they are separately projected
  and contain no credentials or private task fields. The frozen Next.js candidate
  currently tightens these dynamic responses to `no-store`; that is safe and the
  edge must never weaken it.

### AG-SEC-021 — One-time Agent credentials had no owner recovery or revocation path

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** `src/lib/service.ts`,
  `src/app/api/agents/[id]/credentials/route.ts`, Agent management UI and OpenAPI
- **Evidence:** The wallet owner can rotate or revoke a credential through an
  explicit same-origin wallet-session endpoint. Rotation stores only a fresh
  scrypt hash and atomically invalidates the prior key; revocation marks the
  Agent offline and authentication rejects it immediately. A later owner rotation
  is the only reactivation path. Operations are owner-rate-limited, emit a
  secret-free audit request before mutation, and inherit private/no-store headers.
  Service and signed-session route regressions cover owner checks, old-key
  rejection, revocation and explicit reactivation.
- **Impact before fix:** A lost registration response could strand the only API
  key behind an already-bound stake position, while an exposed key could not be
  formally revoked through the product.
- **Fix:** Added a complete owner-controlled credential lifecycle plus human and
  machine discovery surfaces.
- **Residual mitigation:** Operators must still store the one-time replacement in
  an approved Secret Manager and restart/roll Agent processes without logging it.
- **False-positive notes:** Rotation does not reveal or decrypt the old key; it
  creates a new random key and replaces only the stored verifier.

### AG-SEC-022 — HTTP credential revocation did not remove on-chain selection eligibility

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** `contracts/src/AgentRegistry.sol`, `src/lib/chain-actions.ts`,
  credential API/UI, canonical chain projection and Agent selection
- **Evidence:** `AgentRegistry` now stores an explicit reversible active bit;
  registration activates it, `setActive(false)` removes eligibility from every
  contract selection path, and reactivation revalidates the exact live stake.
  Status changes update `registryHash`, emit `AgentStatusUpdated`, and repeated
  writes are idempotent. The browser waits for configured confirmations before
  the matching HTTP mutation, while production API calls verify exact registered
  position and expected chain status. Canonical indexed events constrain public
  online projection and Demo selection rejects revoked records. Full Solidity,
  projection, service and signed-session regressions cover these rules. The fixed
  22-command QA passed from 2026-08-31T22:50:05.655Z through
  2026-08-31T23:02:15.174Z and bound source SHA-256
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Impact before fix:** Revoking an API key made the Web identity unusable but
  left the wallet eligible for future evaluator/tester selection on-chain,
  producing assignments that could not authenticate or complete.
- **Fix:** Added a two-phase, fail-closed chain-plus-credential pause/recovery
  protocol rather than treating a database flag as protocol authority.
- **Residual mitigation:** A transaction confirmed on BSC followed by an HTTP
  outage is safe but temporarily incomplete; retrying the idempotent chain step
  and HTTP operation converges the two layers. Deep post-confirmation reorgs are
  handled fail-closed and require the owner/operator to repeat reconciliation.
- **False-positive notes:** Starting stake withdrawal still removes eligibility
  independently and is not replaced by the reversible active switch.

### AG-SEC-023 — Revocation retained the obsolete Agent credential verifier

- **Severity:** Medium
- **Status:** Fixed in current QA-bound candidate
- **Location:** `src/lib/service.ts`, credential lifecycle tests, production smoke,
  human UI, OpenAPI and machine dashboard action contract
- **Evidence:** The revocation transaction now clears the legacy Demo plaintext,
  scrypt hash and salt in the same serialized database mutation that records the
  stable revocation timestamp and offline state. Unit coverage inspects the stored
  record directly, and the PostgreSQL smoke fails if any obsolete verifier material
  survives. Recovery always creates an unrelated random key, salt and verifier.
  The fixed 22-command QA passed from 2026-08-31T22:50:05.655Z through
  2026-08-31T23:02:15.174Z and bound source SHA-256
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Impact before fix:** Authentication correctly rejected a revoked Agent, but its
  obsolete verifier remained at rest. A future defect that cleared only
  `revokedAt` could therefore revive the old key, and backups retained unnecessary
  credential material.
- **Fix:** Treat revocation as cryptographic erasure as well as a state transition.
- **Residual mitigation:** Historical backups created before this fix may still
  contain obsolete high-entropy hashes or Demo keys and remain subject to the
  configured encrypted retention/deletion policy.
- **False-positive notes:** A scrypt verifier is not plaintext and the old API key
  was already rejected while `revokedAt` was present; this finding concerns data
  minimization and defense against accidental credential resurrection.

### AG-SEC-024 — Agent management UI was not bound to the authenticated wallet before broadcast

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** `/agents`, `src/lib/agent-management.ts`, browser chain actions,
  Agent registration/credential components and machine discovery contracts
- **Evidence:** Production management controls now require a valid wallet session,
  and the client receives credential state only for Agent records whose owner
  matches that session. A shared pre-broadcast guard compares the connected wallet
  with the session owner before registration or `setActive` writes. Unit coverage
  proves owner filtering strips endpoints/credentials/other owners and rejects a
  mismatched wallet before a transaction client is invoked.
  The packaged production Web smoke checks both unauthenticated and owner-session
  `/agents` HTML, and the fixed 22-command QA passed from
  2026-08-31T22:50:05.655Z through 2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Impact before fix:** An unauthenticated visitor received every Agent's hidden
  revocation timestamp in the React payload and saw management controls. A user
  signed in as wallet A but connected to wallet B could successfully broadcast a
  registration or status transaction for B before the HTTP mutation predictably
  failed its session-owner check, leaving a confusing partial operation.
- **Fix:** Treat the wallet session as the management projection boundary and bind
  the connected signer to it before any irreversible external action.
- **Residual mitigation:** Server ownership, exact stake and active-state checks
  remain authoritative against non-browser callers and malicious clients.
- **False-positive notes:** Public Agent identity, role, capability, stake,
  reputation and online status remain intentionally discoverable through the
  explicitly redacted Agent API; only credential-management metadata is private.

### AG-SEC-025 — SDK attached Agent credentials to public reads and omitted the directory contract

- **Severity:** Medium
- **Status:** Fixed in current QA-bound candidate
- **Location:** `src/sdk/client.ts`, `GET /api/agents`, OpenAPI, well-known
  discovery, AI dashboard and SDK/API contract tests
- **Evidence:** The SDK now routes discovery, statistics, dashboard, chain config,
  public task reads and `listAgents()` through an unauthenticated request path that
  cannot attach Agent headers. OpenAPI 0.5.0 defines both GET and POST on
  `/api/agents`, with a closed `PublicAgent` schema; well-known and the AI action
  contract name the directory explicitly. API coverage asserts the exact response
  keys and rejects endpoint, scope, position, revocation and credential fields.
  The packaged production Web smoke reads the live directory and method-complete
  OpenAPI, and the fixed 22-command QA passed from 2026-08-31T22:50:05.655Z
  through 2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Impact before fix:** A configured SDK sent `x-agent-key` on requests that did
  not require authentication, unnecessarily exposing the credential to additional
  access-log and middleware paths. External Agents also had to guess that the
  registration path supported a public GET directory because OpenAPI exposed POST
  only and the SDK had no method.
- **Fix:** Separate public and authenticated SDK transports and make discovery
  method-complete rather than path-only.
- **Residual mitigation:** Operators must still redact inbound headers at the
  edge and application logs; non-SDK clients remain responsible for not sending
  credentials to public endpoints.
- **False-positive notes:** Requests remained same-origin and no known log leak
  was observed; this finding reduces unnecessary secret propagation and removes
  an interoperability ambiguity.

### AG-SEC-026 — Exact Agent registration retries perturbed the registry proof

- **Severity:** Medium
- **Status:** Fixed in current QA-bound candidate
- **Location:** `contracts/src/AgentRegistry.sol`, `src/lib/chain-actions.ts`,
  registration UI, integration documentation and regressions
- **Evidence:** The contract returns after ownership and live-stake validation
  when position, capability bits and active state already match, preserving the
  event stream, Agent count and `registryHash`. The browser reads all three
  decision fields at one block and skips the wallet write on an exact match while
  continuing the server registration needed to recover a lost response. Solidity
  and unit regressions cover the contract and browser decision boundary. The
  fixed 22-command QA passed from 2026-08-31T22:50:05.655Z through
  2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Impact before fix:** A timeout after confirmation could cause a browser retry
  to broadcast an unnecessary transaction. The exact duplicate changed
  `registryHash` and emitted registration/status events despite no material state
  change, perturbing future candidate-set proofs and complicating reconciliation.
- **Fix:** Added matching idempotency guards on-chain and before browser broadcast.
- **Residual mitigation:** A material difference or inactive Agent still requires
  a confirmed transaction; the server continues to verify exact position and
  active state before creating the credential identity.
- **False-positive notes:** The duplicate transaction did not transfer another
  stake or increase `agentCount`; the finding concerns proof stability, avoidable
  transaction cost and crash recovery.

### AG-SEC-027 — Lost registration responses could not recover the server identity

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** `src/lib/service.ts`, `POST /api/agents`, registration UI,
  OpenAPI, integration guide and production delivery smoke
- **Evidence:** An exact retry by the authenticated wallet now runs inside the
  serialized database transaction, retains the existing Agent ID, replaces the
  credential verifier and returns one unrelated plaintext key with HTTP 200.
  Recovery requires the same owner, position, name, role, endpoint, capabilities
  and scopes plus an active, non-revoked record. Mismatch and inactive cases fail
  with stable 409 errors. Requests are owner-rate-limited and audited before the
  credential derivation/mutation. Unit, route and packaged PostgreSQL/Web/RPC
  coverage prove same-ID recovery, single identity count and old-key rejection.
  The fixed 22-command QA passed from 2026-08-31T22:50:05.655Z through
  2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Impact before fix:** Although the browser and contract avoided a duplicate
  chain transaction, the subsequent server call always returned
  `AGENT_STAKE_POSITION_ALREADY_BOUND`. Losing the first HTTP response therefore
  stranded the one-time credential and contradicted the advertised recovery
  flow, forcing a user to discover a separate Agent ID recovery path they might
  not possess.
- **Fix:** Treat an exact active same-owner registration as atomic credential
  recovery, while refusing to use registration as a metadata edit or revocation
  bypass.
- **Residual mitigation:** A deliberately revoked/inactive Agent must use the
  explicit owner credential endpoint after confirming `setActive(true)`; the
  registration endpoint never silently reactivates it.
- **False-positive notes:** The owner could already rotate a credential when the
  Agent ID was known. This finding covers the crash window where the first
  response containing both the new ID and its only plaintext key was lost.

### AG-SEC-028 — AI dashboard schema rejected its own credential-revocation action

- **Severity:** Medium
- **Status:** Fixed in current QA-bound candidate
- **Location:** OpenAPI `AiDashboard.actionContracts`, AI dashboard and contract tests
- **Evidence:** The machine dashboard advertises credential revocation with the
  exact HTTP `DELETE` verb. OpenAPI 0.5.2 now includes `DELETE` in the action
  method enum, and a regression requires the schema enum to contain every method
  emitted by the runtime dashboard while separately requiring each method/path
  pair to exist as an OpenAPI operation. The fixed 22-command QA passed from
  2026-08-31T22:50:05.655Z through 2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Impact before fix:** An Agent validating the public dashboard against its
  advertised schema could reject the entire response because one legitimate
  action used a method the schema declared impossible. A permissive consumer
  might ignore that failure and lose the revocation capability.
- **Fix:** Aligned the closed method enum with runtime actions and bound future
  emitted methods to the schema in tests.
- **Residual mitigation:** The method/path contract describes discovery only;
  server-side wallet ownership and chain-state checks remain authoritative.
- **False-positive notes:** The concrete DELETE operation already existed under
  `/api/agents/{agentId}/credentials`; only the containing dashboard schema was
  inconsistent.

### AG-SEC-029 — OpenAPI wallet-session declarations contradicted runtime authorization

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** OpenAPI wallet operations, auth route tests and packaged delivery smoke
- **Evidence:** OpenAPI 0.5.7 marks Agent registration and task-definition
  review with required `WalletSession` security. Session inspection and logout
  deliberately have no authentication requirement: inspection returns an exact
  nullable session projection and logout can safely expire a stale/invalid
  cookie, while both remain private/no-store and logout remains same-origin.
  Closed response schemas cover nonce, verification, session and logout fields.
  Contract tests bind these declarations, and packaged production coverage
  rejects unauthenticated registration before exercising authenticated recovery.
  The fixed 22-command QA passed from 2026-08-31T22:50:05.655Z through
  2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Impact before fix:** Generated or strict clients could attempt protected,
  expensive mutations without first establishing a wallet session, then treat
  the resulting 401 as an undocumented failure. Conversely, they could refuse
  to probe logged-out state or clear an invalid cookie because the contract
  falsely required the very session being inspected or removed.
- **Fix:** Aligned operation-level security with route behavior and added exact
  authentication response contracts.
- **Residual mitigation:** A declared cookie scheme does not replace server-side
  signature, chain-ID, owner and same-origin verification; those checks remain
  authoritative.
- **False-positive notes:** Runtime authorization itself was not bypassed. The
  defect was in the machine contract and could still cause unsafe client flows,
  unnecessary requests and broken recovery UX.

### AG-SEC-030 — Production SDK advertised Demo-only task mutations

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** `src/sdk/client.ts`, reference Agent workers, integration examples,
  OpenAPI/SDK contract tests
- **Evidence:** The exported SDK methods `claimTask`, `submitWork` and
  `submitTest` target HTTP routes whose first production-mode action is to reject
  with `ONCHAIN_ACTION_REQUIRED`. Those operations are deliberately absent from
  the production OpenAPI contract, yet the exported integration example called
  `submitWork`, making the reference path fail in production. The rendered
  integration example also passed a third `uploadArtifact` argument that the SDK
  does not accept.
- **Impact:** An AI Agent following the SDK surface or copied example can upload
  an artifact successfully, then fail at the canonical commitment step or retry
  an unsupported HTTP mutation instead of broadcasting the required BSC
  transaction. This creates ambiguous recovery behavior around paid, stateful
  work.
- **Fix:** Remove Demo-only mutations from the production reference client,
  isolate local Demo calls in explicitly named helpers, align all production
  examples with the on-chain flow, and add a regression that rejects Demo routes
  in the production SDK surface.
- **Fix evidence:** The 236-test / 64-file suite, typecheck, lint, Worker build,
  production Web build and packaged Agent delivery smoke pass. The SDK regression
  enumerates every production client method and verifies its exact OpenAPI
  operation; the production prototype has none of the three Demo mutations.
  The fixed 22-command QA passed from 2026-08-31T22:50:05.655Z through
  2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Residual mitigation:** Production runtime already fails closed; the defect is
  contract discoverability and client guidance rather than a production
  authorization bypass.
- **False-positive notes:** The routes remain useful for the loopback Demo UI and
  deterministic local service tests. They must stay clearly outside the
  production machine contract.

### AG-SEC-031 — Wallet verification and transient authentication state were unbounded

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** wallet nonce/verification routes, PostgreSQL nonce/rate-limit
  storage, OpenAPI and production smoke
- **Evidence:** Challenge issuance was limited to ten requests per client per
  minute, but `/api/auth/verify` performed no application-level client limit.
  Expired/consumed `auth_nonces` and inactive per-client `rate_limits` rows had
  indexes or upsert behavior but no deletion path.
- **Impact:** Distributed or sustained invalid verification traffic could cause
  avoidable database work and, for valid one-time challenges, signature work.
  Over time, unique client identities and authentication attempts could grow the
  two transient tables without bound, degrading authentication availability.
- **Fix:** Apply a trusted-client-key verification limit before body/signature
  processing, document HTTP 429, prune expired nonce rows and inactive rate-limit
  windows with indexed bounded-retention queries, and exercise both cleanup
  paths against PostgreSQL in production smoke.
- **Fix evidence:** Route tests bind the pre-body 20/minute verification limit and
  OpenAPI 429. Production smoke inserts two-day-old nonce/rate-limit records and
  proves indexed 24-hour cleanup deletes both. Packaged production smoke submits
  twenty invalid verification attempts and proves the twenty-first receives the
  stable `RATE_LIMIT_EXCEEDED` response. The fixed 22-command QA passed from
  2026-08-31T22:50:05.655Z through 2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Residual mitigation:** External WAF/rate limiting remains a mandatory
  independent production gate and must absorb larger distributed attacks; local
  limits provide defense in depth, not edge-level DDoS protection.
- **False-positive notes:** Nonces are cryptographically random and stored only
  as hashes, and the missing cleanup did not allow authentication bypass. This
  finding concerns resource exhaustion and lifecycle hygiene.

### AG-SEC-032 — Wallet-auth runtime validation and error statuses contradicted OpenAPI

- **Severity:** High
- **Status:** Fixed and bound to current application QA
- **Location:** wallet nonce/verification schemas, API error mapping, OpenAPI and
  packaged authentication smoke
- **Evidence:** OpenAPI declared closed address/nonce/message/signature objects,
  but the routes passed generic TypeScript assertions from parsed JSON rather
  than executing those schemas. Extra fields and malformed values could reach
  authentication logic. Runtime returned 401 for an invalid signature, 409 for
  an expired/unknown challenge or message mismatch, 400 for malformed input and
  403 only for origin failure, while OpenAPI advertised one 403 for all cases.
- **Impact:** Generated clients could send values the machine contract says are
  impossible, receive undocumented statuses and retry or abandon authentication
  incorrectly. Non-string values could also produce avoidable internal errors
  before a stable validation response.
- **Fix:** Execute strict shared Zod schemas before challenge/signature logic,
  bound the exact server-issued message size, map all invalid authentication
  credentials to 401 while preserving origin 403, and enumerate 400/401/403/
  413/415/429 responses in OpenAPI and runtime tests.
- **Fix evidence:** Nonce and verification routes now execute shared strict Zod
  schemas. Focused route/schema/error tests bind rejection before authentication,
  exact 400/401/403 behavior and OpenAPI 0.5.7 response enumeration. Packaged
  smoke also requires a closed-schema 400, nineteen stable invalid-challenge
  401 responses and a twenty-first-request 429. The fixed 22-command QA passed
  from 2026-08-31T22:50:05.655Z through 2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Residual mitigation:** A valid signature still cannot be forged and the
  one-time nonce was already atomically consumed. Schema enforcement improves
  fail-closed behavior and client interoperability rather than replacing
  cryptographic verification.
- **False-positive notes:** TypeScript annotations do not validate untrusted JSON
  at runtime; this is a concrete contract gap even though honest browser clients
  sent the expected shape.

### AG-SEC-033 — Agent registration runtime schema contradicted OpenAPI

- **Severity:** High
- **Status:** Fixed and bound to current application QA
- **Location:** Agent registration shared schema, route, OpenAPI and packaged
  registration smoke
- **Evidence:** OpenAPI declared `AgentRegistration` as a closed object, required
  `stakePositionId` and described `owner` as the authenticated BSC wallet. The
  runtime Zod schema was not strict, made the stake position optional and used
  only the generic three-character actor constraint for the owner. Unknown
  properties were silently removed, and missing/malformed identity fields could
  reach later session or chain logic instead of returning the documented 400.
- **Impact:** Generated Agent clients could observe undocumented status codes,
  believe malformed registration succeeded validation, or retry an invalid
  request as a chain/state conflict. Silent field removal also breaks exact
  request-signing and machine-contract expectations.
- **Fix:** Execute one strict shared registration schema with an exact BSC address,
  required numeric stake position and bounded fields; align OpenAPI constraints,
  and bind rejection-before-registration in route and packaged-runtime tests.
- **Fix evidence:** The shared schema is strict, requires a numeric stake position
  and exact wallet shape, rejects duplicate scopes, and is field-bound to OpenAPI
  0.5.6. Route tests prove malformed, incomplete and extended bodies return 400
  without mutation; packaged smoke requires the same 400 from the production
  build. The fixed 22-command QA passed from 2026-08-31T22:50:05.655Z through
  2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Residual mitigation:** Wallet-session ownership and exact chain-state checks
  remain authoritative. Schema validation improves fail-closed behavior and
  interoperability; it does not replace those authorization checks.
- **False-positive notes:** TypeScript inference and later chain validation do not
  make a permissive request parser equivalent to the advertised closed schema.

### AG-SEC-034 — Public write contracts were incomplete or silently extensible

- **Severity:** High
- **Status:** Fixed and bound to current application QA
- **Location:** OpenAPI JSON request bodies; task commitment, job, artifact,
  hidden-test, evaluator and signed-evidence schemas
- **Evidence:** Several OpenAPI-closed Artifact/Agent identity bodies used
  non-strict Zod or generic TypeScript assertions, while job envelopes and hidden
  finalization silently removed unknown properties. Task commitment creation and
  transaction recovery consumed JSON bodies that OpenAPI did not declare at all.
  Signed evaluator and tester reports exposed only placeholder objects, omitting
  fields required by runtime signature verification.
- **Impact:** An AI-generated client could not construct valid signed evidence or
  persist a publication transaction from machine discovery alone. Silent field
  removal could also make the server hash a different object from the one the
  caller believed it submitted.
- **Fix:** Close every advertised JSON write envelope in runtime and OpenAPI,
  share strict Agent delivery and task-commitment schemas, document all signing
  fields and bounds, and enumerate 400/413/415 for all 19 JSON operations. Keep
  only the named job `result` value extensible under the existing 64 KiB cap.
- **Fix evidence:** Contract tests resolve every inline/component request schema,
  require `additionalProperties:false`, verify all body-policy responses, and
  compare runtime evaluator, evidence, commitment and transaction field sets to
  OpenAPI 0.5.7. Packaged smoke rejects extended Artifact upload/finalize bodies.
  A source-level regression additionally proves all 29 repository JSON decoders
  execute a runtime Schema and no route retains a generic TypeScript-only cast.
  The fixed 22-command QA passed from 2026-08-31T22:50:05.655Z through
  2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.
- **Residual mitigation:** Semantic task, assignment, signature, artifact and
  chain invariants still execute after schema validation. OpenAPI completeness
  does not replace authorization or independent Tester selection.
- **False-positive notes:** A TypeScript generic on `readJsonBody` performs no
  runtime validation, and placeholder `type:object` schemas are not sufficient
  instructions for a machine client that must sign the exact canonical object.

### AG-SEC-035 — Reference SDK trusted malformed successful protocol responses

- **Severity:** High
- **Status:** Fixed and bound to current application QA
- **Location:** `src/sdk/client.ts`, SDK contract tests and public machine
  response schemas
- **Evidence:** The client bounded and parsed JSON, but returned every successful
  body through a generic TypeScript cast. A `200 {}` response therefore resolved
  as a typed dashboard, task, lease or artifact result even when required fields
  were absent or had the wrong type. TypeScript annotations do not validate
  network data at runtime.
- **Impact:** An AI Agent could treat an incomplete or contract-incompatible 200
  response as protocol truth, infer a missing identity, assignment, amount or
  next action, and fail later with an ambiguous local exception. This contradicts
  the fail-closed machine contract and stable-error requirements.
- **Fix:** Parse every successful production SDK response with a closed, bounded
  runtime schema matching its OpenAPI operation and return a stable
  `PROTOCOL_RESPONSE_SCHEMA_INVALID` error on mismatch. OpenAPI 0.5.7 now names
  closed envelopes for all 17 production SDK HTTP operations; discovery is the
  eighteenth runtime-validated success path.
- **Fix evidence:** Focused SDK tests reject missing, mistyped and unknown
  success fields, accept a valid statistics projection, and prove all 18 runtime
  schemas reject an empty object. Projection tests parse the real discovery,
  statistics and dashboard builders. An OpenAPI regression and packaged smoke
  require every SDK operation's 2xx envelope to resolve to a closed object.
  The fixed 22-command QA passed from 2026-08-31T22:50:05.655Z through
  2026-08-31T23:02:15.174Z against source
  `sha256:4dfdcdc19852213a5bd4202802f029642d57e5e17275964ece31049c80796cfb`.

### AG-SEC-036 — Signed-report retries returned data that was not the stored record

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** PostgreSQL signed evaluator/tester evidence writes, evaluator and
  evidence API responses, SDK success-response contracts
- **Evidence:** An exact evaluator retry returned the database comparison-only
  `signature` field although the first success and closed OpenAPI response did
  not. Signed tester evidence used `ON CONFLICT DO NOTHING` but always returned
  the newly generated input ID; on a duplicate report hash that ID was never
  inserted. The route then calculated `evidenceHash` from the retry signature
  instead of the canonical stored row.
- **Impact:** A retry after response loss could fail strict SDK parsing, persist a
  nonexistent evidence ID locally, or broadcast a hash for signature material
  that differs from the database audit record. This breaks stable idempotency and
  recovery at the signed protocol boundary.
- **Fix evidence:** Both database operations now return the canonical stored
  response on exact retry and reject equivocation. Evidence API responses and
  the broadcast `evidenceHash` derive only from that canonical row. Evaluation
  and tester signatures use V2 domain-separated messages bound to chain 97, the
  exact TaskRegistry and task; tester messages additionally bind work round,
  execution mode, artifact and exact executor order. Focused cryptographic and
  OpenAPI contract tests pass. The real PostgreSQL production smoke now covers
  first submission, exact retry and conflicting retry. The uninterrupted
  22-command QA passed from `2026-08-31T23:50:47.957Z` through
  `2026-09-01T00:02:58.358Z` against source
  `sha256:ee593f2c80b60802f18d067d43a66b17f6f2aa7272182efcbf3c5c00e42a4f3c`
  and candidate `XUQORE28MF8J8lWpXtYt9`.

### AG-SEC-037 — Signed-report records omitted the exact signature preimage

- **Severity:** High
- **Status:** Fixed in current candidate
- **Location:** PostgreSQL signed evaluator/tester evidence schema and writes
- **Evidence:** V2 signatures bind chain, TaskRegistry and task context, but the
  database previously retained only the report, signature and a subset of the
  domain. After a work-round or executor-order change, the exact signed message
  could not be reconstructed from the row alone.
- **Impact:** Long-term audit, incident recovery and independent signature
  verification could depend on mutable current projection state and reconstruct
  the wrong preimage even though the original route verification succeeded.
- **Fix evidence:** New evaluator/tester writes persist the exact verified
  signing version and full message. Exact retries compare those fields and
  reject drift. The additive migration preserves legacy rows as explicit null
  preimages instead of fabricating history. The real PostgreSQL migration/retry
  smoke recovers both stored signatures from the persisted messages. The fixed
  22-command QA passed from `2026-08-31T23:50:47.957Z` through
  `2026-09-01T00:02:58.358Z` against source
  `sha256:ee593f2c80b60802f18d067d43a66b17f6f2aa7272182efcbf3c5c00e42a4f3c`
  and candidate `XUQORE28MF8J8lWpXtYt9`.

### AG-SEC-038 — Production projection trusted stored report bodies without re-verification

- **Severity:** High
- **Status:** Fixed in current candidate
- **Location:** Production `protocolSnapshot` signed evaluator/tester projection
- **Evidence:** The projection matched the stored `reportHash` or derived
  evidence hash to a chain event, but did not recompute that hash from the JSON
  report or recover the signature before using category, result, coverage and
  weight fields.
- **Impact:** Accidental database corruption or an inconsistent restore could
  project report fields that were never covered by the chain-bound signature,
  misleading human and machine consumers despite a matching stored hash column.
- **Fix evidence:** Stored V2 records are now strictly parsed; their report hash,
  exact message, configured TaskRegistry and recovered signer are checked before
  projection. Missing-domain legacy records fail closed unless an offline caller
  explicitly opts in. Unit tests reject report, message, registry and legacy
  drift. The real PostgreSQL smoke mutates a stored report and proves rejection.
  The fixed 22-command QA passed from `2026-09-01T00:11:45.606Z` through
  `2026-09-01T00:23:56.404Z` against source
  `sha256:3b493f5d1b655d4eac3cad5f1ba037d94a30ba77d9b77c83de3d0dfbd267a811`
  and candidate `a-M-8kUr8edmOpbnfPw6m`.

### AG-SEC-039 — Tester projection did not rebind the signed task context

- **Severity:** High
- **Status:** Fixed in current candidate
- **Location:** Stored Tester evidence validation in production projection
- **Evidence:** V2 messages contained work round, execution mode and executor
  order, but read-time validation only checked TaskRegistry, task, artifact,
  report and signer. The contract stores an opaque evidence hash and cannot
  independently interpret those off-chain message fields.
- **Impact:** An old-round record or directly submitted opaque chain hash could
  be associated with the current task projection even when team membership or
  execution context had changed.
- **Fix evidence:** Read-time verification now recomputes the exact current
  executor-order hash and requires the signed work round and mode to match the
  chain projection. Unit tests reject wrong round, mode and order. The real
  PostgreSQL smoke verifies a stored signed row, advances the expected round and
  proves rejection. The fixed 22-command QA passed from
  `2026-09-01T00:30:09.395Z` through `2026-09-01T00:42:18.267Z` against source
  `sha256:39440d7141081fd4fec70129101c8083a7c1a5a4c76b220e89f08b0b1e42d7a7`
  and candidate `M_ssuYyeFRFQ_toJrOBPx`.

### AG-SEC-040 — AI dashboard advertised only a partial production workflow

- **Severity:** Medium
- **Status:** Fixed in current candidate
- **Location:** Versioned public AI dashboard, OpenAPI dashboard schema and SDK
  response validation
- **Evidence:** The dashboard described itself as an explicit machine action
  contract but exposed only seven selected operations. It omitted 26 documented
  production operations, including job heartbeat/completion, evaluator writes,
  encrypted artifact delivery, the hidden-test PUT step and signed Tester
  evidence. Action entries also lacked the OpenAPI `operationId` needed for an
  unambiguous schema lookup.
- **Impact:** An Agent relying on the advertised dashboard could not discover or
  deterministically map the complete production workflow and would have to guess
  paths, methods or schemas despite the product's no-guessing contract.
- **Fix evidence:** Dashboard schema 1.1 now enumerates all 33 OpenAPI 0.5.9
  operations with exact `operationId`, method, path, phase, role,
  authentication precondition and effect. The human panel groups the complete
  set into accessible native disclosure sections. Contract tests compare both
  sets bidirectionally, reject duplicate operation IDs and validate the strict
  SDK response schema; packaged production smoke requires the full count and
  the previously missing PUT operation. The fixed 22-command QA passed from
  `2026-09-01T01:05:01.198Z` through `2026-09-01T01:17:10.608Z` against source
  `sha256:33450d102e7f8c9e39270e2c3ebcd8c09afcf7720703b9c42d14edd35014ab71`
  and candidate `0Ph9ri5XvpoLeLx9pzZP7`.

### AG-SEC-041 — OpenAPI and dashboard agreed while both omitted production routes

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** Next API route inventory, well-known discovery, OpenAPI, AI
  dashboard and wallet workflow response projection
- **Evidence:** Bidirectional OpenAPI/dashboard tests proved 33/33 documented
  operations, but did not start from the actual route tree. Production business-
  adoption GET/POST and wallet-notification GET/read routes therefore remained
  absent from OpenAPI, discovery and the dashboard even though business adoption
  is required by final pilot qualification.
- **Impact:** Publisher Agents could not discover or construct a required signed
  production attestation without reading frontend source. More generally, two
  generated contracts could falsely certify completeness while jointly omitting
  a real authenticated route.
- **Fix evidence:** A source-level inventory now extracts all 55 exported API
  methods. It requires 37 production protocol operations in OpenAPI 0.6.1 and
  dashboard schema 1.2 and explicitly classifies the remaining 18 as Admin,
  operational, browser-preference or Demo-only. The four missing operations are
  present in discovery, OpenAPI and dashboard action contracts. Their runtime
  responses are strictly parsed, database timestamps are normalized, event
  payloads are limited to 64 properties / 64 KiB, private responses set no-store
  headers, and wallet sessions enforce chain 97. Focused route, response,
  OpenAPI, dashboard, SDK, TypeScript and Lint checks pass. The packaged runtime
  additionally proves unauthenticated wallet reads return 401, notification
  responses are private/no-store and real PostgreSQL timestamps normalize to
  the public schema. The fixed 22-command QA passed from
  `2026-09-01T02:02:11.966Z` through `2026-09-01T02:14:20.827Z` against source
  `sha256:e46d2872a25e272271f412aa451c59c2efdcc0288d1ef6ded554cde14473b929`
  and candidate `O4FNqdxmkTRmmRUxYKjkI`.

### AG-SEC-042 — Non-SDK production successes lacked machine response contracts

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** OpenAPI responses and task-definition, task-commitment,
  credential-management and hidden-test API routes
- **Evidence:** The earlier response audit covered the production SDK subset,
  while ten real production operations advertised a 2xx status with no JSON
  schema. OpenAPI/dashboard operation counts could therefore pass even though a
  wallet or browser Agent still had to guess successful response fields.
- **Impact:** Contract generation could produce no usable success type, response
  drift would remain undetected, and sensitive authenticated results could be
  cached inconsistently.
- **Fix evidence:** OpenAPI 0.6.1 makes all 37 production operations expose all 38 JSON 2xx
  responses through closed envelopes. The ten affected routes parse their
  actual success output with strict bounded runtime schemas, normalize
  PostgreSQL timestamps to ISO where required, and set private/no-store headers.
  Source and packaged-runtime contract checks enumerate the complete production
  set rather than a curated SDK list. Focused schema, route inventory, OpenAPI,
  TypeScript and Lint checks pass. The fixed 22-command QA passed from
  `2026-09-01T02:02:11.966Z` through `2026-09-01T02:14:20.827Z` against source
  `sha256:e46d2872a25e272271f412aa451c59c2efdcc0288d1ef6ded554cde14473b929`
  and candidate `O4FNqdxmkTRmmRUxYKjkI`; independent digest and permission
  verification also passed.

### AG-SEC-043 — Production errors were undocumented and validation codes were unstable

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** Shared API error projection, reference SDK and OpenAPI error
  responses
- **Evidence:** All 134 previously advertised production 4xx/5xx entries had
  descriptions but no JSON Schema. Every route could additionally reach the
  shared safe 500 path, but none consistently advertised it. Zod failures used
  the dynamic serialized issue list as the top-level `error` value, and the SDK
  trusted any string found in an error body.
- **Impact:** Agents could not generate a stable error type or safely branch on
  validation failures, malformed upstream bodies could inject arbitrary error
  codes, and the documented status surface under-reported internal failures.
- **Fix evidence:** OpenAPI 0.6.7 binds all 185 error statuses for the complete
  37-operation inventory to a closed bounded `ProtocolErrorResponse` and adds a
  fail-closed 500 to every operation. Runtime Zod failures emit
  `VALIDATION_ERROR` with at most 32 sanitized code/path/message issues;
  unclassified, non-Error and oversized codes become `INTERNAL_ERROR`. The SDK
  validates the entire envelope and exposes bounded issues on
  `AgentProtocolError`. Source and packaged-runtime regressions enumerate the
  full status set. Focused schema, SDK, route, TypeScript and Lint checks pass.
  The fixed 22-command QA passed from `2026-09-01T04:32:18.215Z` through
  `2026-09-01T04:44:28.608Z` against source
  `sha256:df09adbb03c51a360c3f17600a7bc697b58768a84714f7d76a0eed86f364c60c`
  and candidate `pzyi7O5lBqKQfT5suo3MY`; independent digest and permission
  verification also passed.

### AG-SEC-044 — Pagination and identity parameters were ambiguous

- **Severity:** Medium
- **Status:** Fixed in current QA-bound candidate
- **Location:** Completed-task query parser, hidden-test ciphertext upload,
  OpenAPI and browser upload flow
- **Evidence:** Completed-task pagination used `Object.fromEntries`, which
  silently collapsed duplicate parameters while Zod stripped unknown keys. An
  unrecognized cursor produced index zero and restarted the first page. OpenAPI
  omitted runtime cursor/category bounds. Hidden-test upload documented a
  required caller-provided `x-publisher`, although runtime accepted its absence
  and the authenticated wallet session already supplied the authoritative owner.
- **Impact:** Agents could miss parameter mistakes, repeat the first page
  indefinitely after a stale cursor, or believe an untrusted duplicate identity
  signal was part of authorization.
- **Fix evidence:** A shared strict parser rejects unknown and duplicate query
  parameters, enforces exact bounds, and maps a stale cursor to an explicit 400.
  OpenAPI 0.6.7 carries matching constraints and error response. Hidden-test PUT
  now derives publisher identity solely from `WalletSession`; runtime, frontend,
  packaged smoke and OpenAPI contain no `x-publisher`. Focused pure, route,
  source-contract, TypeScript and Lint checks pass. The fixed 22-command QA
  passed from `2026-09-01T04:32:18.215Z` through
  `2026-09-01T04:44:28.608Z` against source
  `sha256:df09adbb03c51a360c3f17600a7bc697b58768a84714f7d76a0eed86f364c60c`
  and candidate `pzyi7O5lBqKQfT5suo3MY`; independent digest and permission
  verification also passed.

### AG-SEC-045 — Agent credential headers allowed unbounded authentication input

- **Severity:** Medium
- **Status:** Fixed in current QA-bound candidate
- **Location:** Shared Agent authentication parser, service authentication,
  OpenAPI security schemes and packaged delivery smoke
- **Evidence:** Agent IDs supplied by bodies were bounded, but the evaluator's
  `x-agent-id` and every `x-agent-key` reached database lookup and potentially
  `scrypt` without a shared runtime header contract. HTTP stacks can merge
  duplicate headers, and OpenAPI advertised only their names.
- **Impact:** Malformed or oversized credentials could create unnecessary
  database/password-hashing work, while generated clients could not discover
  the accepted header bounds or duplicate policy.
- **Fix evidence:** A strict pre-authentication parser accepts one 3–120 byte
  ASCII Agent identifier and one 8–128 byte `amp_` token. Missing, malformed,
  oversized and duplicate-merged values all fail as
  `AGENT_AUTHENTICATION_FAILED` before database lookup or `scrypt`, avoiding a
  credential oracle. OpenAPI 0.6.7 publishes exact vendor-extension constraints;
  unit and packaged-smoke contract regressions reject drift. The fixed
  22-command QA passed from `2026-09-01T04:32:18.215Z` through
  `2026-09-01T04:44:28.608Z` against source
  `sha256:df09adbb03c51a360c3f17600a7bc697b58768a84714f7d76a0eed86f364c60c`
  and candidate `pzyi7O5lBqKQfT5suo3MY`; independent digest and permission
  verification also passed.

### AG-SEC-046 — Dynamic path parameters bypassed executable bounds

- **Severity:** Medium
- **Status:** Fixed in current QA-bound candidate
- **Location:** All production dynamic-path routes, shared path schemas, OpenAPI
  parameters and packaged delivery smoke
- **Evidence:** Several UUID parameters were documented but not parsed at the
  route boundary; task, Agent and queue-job identifiers were commonly passed
  directly to PostgreSQL, Redis or projection lookups. Eight operations did not
  advertise a 400 for malformed paths. Hidden-test ciphertext PUT also omitted
  reachable wallet/origin/conflict/media-type errors.
- **Impact:** Agents could not reliably distinguish malformed identifiers from
  absent/conflicting resources, and oversized queue/database keys could reach
  downstream work despite a narrower machine contract.
- **Fix evidence:** Shared strict Schemas now cover UUIDs, positive 1–78 digit
  on-chain task IDs, 3–120 character Agent IDs and 1–200 character queue-job
  IDs. All 18 production dynamic-path operations parse before database, Redis
  or chain work. OpenAPI 0.6.7 carries exact schemas and a closed 400 for every
  operation; hidden-test PUT additionally declares 401/403/409/415. Unit,
  source/OpenAPI inventory and packaged-smoke regressions cover drift. The
  fixed 22-command QA passed from `2026-09-01T04:32:18.215Z` through
  `2026-09-01T04:44:28.608Z` against source
  `sha256:df09adbb03c51a360c3f17600a7bc697b58768a84714f7d76a0eed86f364c60c`
  and candidate `pzyi7O5lBqKQfT5suo3MY`; independent digest and permission
  verification also passed.

### AG-SEC-047 — Binary upload failures used route-local and JSON error semantics

- **Severity:** Medium
- **Status:** Fixed in current QA-bound candidate
- **Location:** Shared request-body reader, hidden-test ciphertext PUT, OpenAPI
  and packaged delivery smoke
- **Evidence:** The shared byte reader reported an empty binary stream as
  `INVALID_JSON_BODY`, while the route used permissive `Number(Content-Length)`
  checks and a separate post-read size check. Malformed or missing data could
  therefore receive unrelated or inconsistent machine errors.
- **Impact:** Agent callers could not reliably distinguish a malformed length,
  absent ciphertext, manifest conflict, or actual bounded overflow, and future
  routes could repeat divergent length parsing.
- **Fix evidence:** One authenticated, manifest-bound shared binary reader now
  emits `BINARY_BODY_REQUIRED` (400), `CONTENT_LENGTH_INVALID` (400),
  `BINARY_CONTENT_LENGTH_MISMATCH` (409), `REQUEST_BODY_TOO_LARGE` (413), and
  media/encoding failures (415). OpenAPI 0.6.7 documents the surface; unit and
  packaged-production smoke tests exercise empty, mismatch and overflow paths.
  The uninterrupted fixed 22-command QA passed from
  `2026-09-01T04:32:18.215Z` through `2026-09-01T04:44:28.608Z` against source
  `sha256:df09adbb03c51a360c3f17600a7bc697b58768a84714f7d76a0eed86f364c60c`
  and candidate `pzyi7O5lBqKQfT5suo3MY`; independent digest and permission
  verification also passed.

### AG-SEC-048 — Agent jobs crossed queue and SDK boundaries as arbitrary objects

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** Agent job Schema, PostgreSQL outbox projection, Redis queue,
  authenticated lease route, SDK, OpenAPI and packaged smoke
- **Evidence:** Redis values were decoded with `JSON.parse(... as AgentJob)`,
  the outbox was cast into that interface, and OpenAPI allowed any `kind` and an
  unbounded object `payload`. A corrupted or drifting job could reach a Worker,
  while an Agent had no machine-readable way to know which fields were valid.
- **Impact:** Queue corruption or producer/consumer drift could cause incorrect
  role delivery, unbounded parsing, repeated poisoned leases or Worker actions
  based on guessed fields rather than a stable protocol contract.
- **Fix evidence:** A strict shared union enumerates eleven kinds, each with one
  role and exact bounded payload. It validates enqueue, outbox dispatch, stored
  Redis recovery, lease, heartbeat, server success and SDK decoding. Chain
  provenance is all-or-none, Postgres timestamps are normalized, and malformed,
  oversized, ID/role-mismatched stored jobs are quarantined. OpenAPI 0.6.7
  exposes exact kind-to-role and kind-to-payload maps. Focused unit tests,
  `queue:smoke`, the real PostgreSQL/Redis reorg smoke and packaged production
  smoke pass. The uninterrupted fixed 22-command QA passed from
  `2026-09-01T04:32:18.215Z` through `2026-09-01T04:44:28.608Z` against source
  `sha256:df09adbb03c51a360c3f17600a7bc697b58768a84714f7d76a0eed86f364c60c`
  and candidate `pzyi7O5lBqKQfT5suo3MY`; independent digest and permission
  verification also passed.

### AG-SEC-049 — Agent job completion accepted arbitrary, non-idempotent results

- **Severity:** High
- **Status:** Fixed in current QA-bound candidate
- **Location:** Completion route, Agent queue, SDK, Workers, OpenAPI and queue /
  reorg / packaged-delivery smoke
- **Evidence:** The completion body accepted optional `unknown`, the SDK exposed
  `result?: unknown`, Redis stored the value directly, and every retry after a
  successful completion failed as an unowned lease. Worker outputs also copied
  artifact storage URLs into durable completion records.
- **Impact:** Agents had to guess output shapes, corrupt or oversized semantic
  results could be retained, a lost HTTP response could not be retried safely,
  and storage location data was duplicated outside the Artifact manifest.
- **Fix evidence:** OpenAPI 0.6.9 and the shared runtime Schema map all eleven
  job kinds to exact closed result contracts. The queue validates against the
  actual leased kind before releasing the lease; validation failure preserves
  the lease. An exact same-Agent/result retry succeeds, while owner or result
  conflicts fail closed. Completion records retain only committed hashes,
  transaction hashes and bounded status metadata. The 307-test suite, typecheck,
  lint, Worker build, real Redis lease smoke, PostgreSQL/Redis reorg smoke and a
  packaged production-Web smoke pass. The uninterrupted fixed QA then passed all
  22 commands and bound the source/candidate recorded in the current evidence
  update above.

## Verified controls and limitations

- The first fixed application-QA gate runs complete unit coverage and then a
  live `pnpm audit --prod --audit-level high --json`; an unreachable advisory
  service or any high/critical production finding invalidates the candidate.
- Artifact delivery uses AES-256-GCM envelopes, immutable ciphertext/plaintext
  commitments, tester-only pre-acceptance access, local publisher decryption after
  acceptance, and release-audit rows.
- The tester sandbox uses no network, a read-only root, dropped capabilities,
  resource/PID limits, hidden tests, and verifier-owned coverage parsing.
- Queue leases are atomic, recover after crashes, and are bound to canonical chain
  provenance.
- These statements describe repository controls. They do not prove BSC Testnet
  deployment, funded independent wallets, external infrastructure, audit closure,
  or real-business pilot acceptance.

## Launch decision

**Not approved for public production launch.** Continue using an unactivated local
candidate only. Close AG-SEC-003, AG-SEC-004, AG-SEC-007, AG-SEC-008, and the BSC
Testnet/real-pilot gates before requesting a final launch review.
