# AgentGrid production release checklist

No launch may be called complete until every mandatory row is backed by the
listed evidence. A passing local test is not evidence of a BSC deployment or a
real-user pilot.

## Definition of done

- **Local delivery complete** means the product flows and AI-friendly dashboard
  are implemented; rules, UI and machine contracts agree; all static, unit,
  contract, build and Worker gates pass; one uninterrupted fixed 22-command
  `release:qa:run` passes against unchanged source; and its source hash, build
  ID, candidate payload and release manifest are cryptographically bound.
- **Public production complete** additionally requires every mandatory external
  row below: live BSC deployment, independently controlled pilot participants,
  production edge/KMS/off-host recovery evidence, independent security audits,
  real-business adoption and accountable sign-off.
- Historical evidence never closes a current-source row. If any external row is
  open, the only accurate status is “local delivery complete; production launch
  blocked”, not “launched”.

## A. Reproducible local gates

- [x] `pnpm lint`
- [x] `pnpm test` — current source passes 348 tests across 92 files. The displayed 100% coverage applies
  only to `src/lib/protocol.ts`; it is not evidence of full Worker/API coverage.
- [x] `pnpm audit --prod --audit-level high --json` — the current production
  graph reports zero info/low/moderate/high/critical advisories; this live audit
  is now part of the first fixed QA command and fails closed if unavailable.
- [x] Isolated QA commands derive their secret scrub list from the canonical
  runtime-secret inventory, removing both direct and `_FILE` forms. A regression
  prevents newly added runtime secrets from contaminating unit-test behavior or
  making the fixed 22-command run depend on the caller's production environment.
- [ ] `pnpm contracts:compile` — current source compiles eleven deployable
  artifacts, including `ProtocolEconomics`; this focused pass is not yet part of
  the final frozen 22-command QA evidence.
- [ ] `pnpm contracts:test` — the uninterrupted current-source full run passed
  29/29 cases
  across protocol lifecycle, role quality, economics and Court arbitration,
  including exact-event selection and public rehabilitation. It remains open
  here because the command must run again inside the final frozen 22-command QA.
- [x] `pnpm build` and `pnpm workers:build` (15 Web/Worker/Ops entry bundles)
- [x] Candidate manifest v2 binds every standalone payload file/internal link,
  entry count and byte count; escaping links and changed chunks are rejected,
  payload paths are sealed read-only, and only owner-only `.next/cache` remains
  mutable.
- [x] `pnpm production:smoke` — PostgreSQL transaction, signed nonce and wallet
  session, canonical evaluator/tester exact retries and conflicting-report
  rejection
- [x] `pnpm queue:smoke` — durable lease ownership, heartbeat, exact completion-
  retry idempotency, conflicting-result rejection, invalid-result lease
  preservation, invalid-enqueue rejection and corrupt stored-job quarantine
- [x] `pnpm artifact:smoke` — checksum, immutable sealed copy and substitution
  rejection
- [x] `pnpm sandbox:smoke` — no network, read-only root, resource caps, real
  hidden tests and verifier-owned coverage
- [x] `pnpm ops:artifact-key:smoke` — disposable-database old-to-new key rotation
- [x] `pnpm ops:backup && pnpm ops:backup:verify` — manifest size/SHA-256 checked
  before a streamed custom dump restored all eleven delivery/lifecycle core tables,
  including server-bound task-definition reviews;
  output completion now requires both `pg_dump` exit 0 and a flushed file stream
- [x] `pnpm reorg:queue:smoke` — exact chain provenance and canonical block time,
  outbox rewind, queued orphan discard, in-flight cancellation,
  replacement-block execution, and capability-mask rejection after projection
  rebuild
- [x] `pnpm agent:delivery:smoke` — isolated production-mode Web processes prove
  candidate-style packaging of `public` and `.next/static`, live HTML dashboard,
  versioned AI JSON dashboard, OpenAPI and well-known discovery contracts, and
  absence of every runtime secret from those public surfaces; they also prove
  lease recovery after a hard crash, Artifact manifest survival across a second
  crash, encrypted upload/finalization, exact completion retry plus conflicting-
  completion rejection, and
  application-level 400/413/415 enforcement for malformed, oversized chunked,
  and unsupported-media JSON requests, bounded chunked hidden-test uploads, and
  runtime browser-chain configuration without build-time public contract values.
  It loads all nine current compiled runtimes, proves readiness opens, changes one
  non-immutable opcode and proves readiness returns HTTP 503, then restores it.
  It also rotates an active Agent key, rejects the old key, confirms an on-chain
  inactive state before HTTP revocation, rejects the revoked key, and confirms
  reactivation before issuing a distinct recovery key.
- [x] `pnpm production:secrets:smoke` — the expanded 13-service topology has no
  plaintext sensitive environment variables, enforces file-only policy, and
  verifies all 15 external role-specific Secret mounts, including dedicated
  off-host backup and task-definition AI credentials; the bundled Migration
  Worker also completes against an isolated database using only 0400 files
- [x] `pnpm ops:kms:smoke` — four fresh values are recovered from exact 0400
  files, AES-256-GCM and three wallet-signature round trips pass, raw values are
  absent from the 0600 report, symlink/mount-write paths are rejected, and the
  resulting `local-smoke` evidence cannot satisfy the production gate.
- [x] Wallet nonce and verification bodies execute OpenAPI 0.8.13's shared
  strict, closed schemas before authentication logic; route/schema regressions
  bind malformed input to 400, invalid credentials to 401, origin failure to
  403, and packaged smoke covers these statuses plus the 20/minute limit.
- [x] OpenAPI 0.8.13 and the runtime domain-bind evaluator/tester signatures
  to the configured chain and TaskRegistry; tester evidence additionally binds
  work round, execution mode, artifact and exact executor order. PostgreSQL
  regression coverage requires exact retries to return the canonical stored ID
  and signature, and conflicting retries to fail. The fixed QA includes that
  real-database smoke and route-level canonical evidence-hash derivation.
- [x] Current source persists the exact verified V2 signing version and message
  for evaluator and tester records, compares the preimage during exact retries,
  and leaves legacy rows explicitly unbackfilled. The fixed QA includes a real
  PostgreSQL migration, retry and stored-message signature-recovery smoke.
- [x] Production projection re-parses stored evaluator/tester reports, recomputes
  report hashes, validates the strict V2 message and configured TaskRegistry,
  and recovers the stored signer before using report fields. Legacy no-domain
  rows are rejected by default. The fixed QA includes unit regressions and a real
  PostgreSQL corruption-rejection smoke.
- [x] Tester evidence projection also binds the message to the current work
  round, collaboration/competition mode and exact executor-order hash. Unit
  regressions reject each mismatch and the real PostgreSQL smoke rejects a
  previous-round context; both are included in the current fixed QA.
- [x] All 37 production operations now advertise all 38 JSON 2xx responses as
  closed envelopes. The ten formerly undocumented task-definition,
  task-commitment, credential-management and hidden-test successes execute
  strict server-side response schemas; authenticated responses are private and
  no-store. The complete contract is included in the current fixed QA below.
- [x] OpenAPI 0.8.13 binds all 185 advertised 4xx/5xx responses across 37
  production operations to one closed bounded `ProtocolErrorResponse`, including
  an explicit fail-closed 500 for every operation. Runtime Zod failures return
  `VALIDATION_ERROR` plus sanitized bounded issues, unclassified exceptions
  become `INTERNAL_ERROR`, and the SDK rejects malformed error envelopes. The
  complete contract is included in the current fixed QA below.
- [x] Completed-task pagination now rejects unknown/duplicate query parameters,
  enforces OpenAPI-aligned limit/cursor/category bounds, and returns an explicit
  400 for stale cursors instead of silently restarting page one. Hidden-test
  ciphertext upload derives publisher identity solely from `WalletSession`; the
  redundant `x-publisher` header was removed from runtime, browser, smoke and
  OpenAPI. Focused runtime/contract/type/lint checks pass and are included in
  the current fixed QA below.
- [x] Agent authentication parses one bounded ASCII Agent ID (3–120 characters)
  and one bounded `amp_` credential (8–128 characters) before database lookup
  or `scrypt`; missing, malformed, oversized and duplicate-merged headers share
  the same 401 failure. OpenAPI 0.8.13 publishes exact constraints and packaged
  smoke rejects contract drift. Focused runtime/contract checks pass and are
  included in the current fixed QA below.
- [x] All 18 production dynamic-path operations execute shared UUID, positive
  on-chain task ID, Agent ID or queue-job ID Schemas before database, Redis or
  chain work, with exact OpenAPI 0.8.13 bounds and a closed 400 response.
  Hidden-test ciphertext PUT also declares its reachable 401/403/409/415
  failures. Focused runtime/source/OpenAPI checks pass and are included in the
  current fixed QA below.
- [x] Hidden-test ciphertext upload uses one authenticated, manifest-bound shared
  binary reader. Empty bodies and malformed lengths are stable 400 errors,
  exact-length conflicts are 409, bounded overflow is 413, and unsupported
  media/encoding is 415. OpenAPI 0.8.13, unit tests and packaged production smoke
  reject status/code drift.
- [x] All sixteen Agent job kinds use one closed runtime union across PostgreSQL
  outbox dispatch, Redis recovery/lease, the authenticated route, SDK and
  OpenAPI 0.8.13. Each kind has an exact role and bounded payload; partial chain
  provenance, unknown/extended kinds, bad IDs, role drift and corrupted stored
  JSON are rejected or quarantined. Unit, queue, reorg and packaged production
  smoke cover the same mapping.
- [x] Every Agent job kind has one closed OpenAPI 0.8.13 and runtime completion-
  result mapping. The authenticated route requires a result, the queue validates
  it against the actual leased kind before completion, and invalid results leave
  the lease recoverable for a corrected retry. An exact same-Agent/result retry
  succeeds idempotently, while an owner or result conflict fails closed. Worker
  results contain only
  durable hashes/transactions and bounded status metadata; signed URLs and
  arbitrary extension objects are rejected. Unit, Redis and packaged-Web smoke
  cover valid, cross-kind, missing-field and retry behavior.
- [x] Wallet notification read mutations visibly report structural success or
  failure through accessible live regions, expose an `aria-busy` disabled state,
  and suppress duplicate in-flight writes for the same notification. Focused
  regression coverage preserves immutable list updates and the interaction
  contract.
- [x] Language preference, clipboard copy and Demo stake/faucet interactions
  catch transport and decode failures, expose accessible structural results and
  busy state, and reject duplicate in-flight actions. A failed locale write
  cannot refresh the page as though the preference had been persisted.
- [ ] Current governed source must complete all 22 commands uninterrupted after
  language, clipboard and Demo mutation failure/busy boundaries froze, from
  `2026-09-01T07:16:46.244Z` through `2026-09-01T07:28:58.095Z`, including the
  307-test / 83-file suite, complete JSON request/response contracts, domain-
  separated signed reports, canonical retry recovery and discovery schema 1.1.
  The prior historical run binds unactivated candidate `unFAJP0q6TybW71fBjdHx`, source SHA-256
  `sha256:e2c88e37870b5bcf909b299d90239151cbb3f627005e330a82cecad8e7d30cac`,
  2,580 payload entries / 69,565,250 bytes, payload SHA-256
  `sha256:e88563e5c91c01f6e5a1f52f695832f577a9dec80d7c449448f8023f8b82ff21`,
  and manifest SHA-256
  `sha256:651c3b7a5329b643b888e3357e223615d6608fe7bd692e34333892e591172679`.
  The external mode-0600 report has file SHA-256
  `c8daad4612fa58a86b08fd4ca8e6f14fcfaef174ab3438081ce883735ad1e816`.
  All 22 exit codes, 316 governed-source entries, payload digest/count/bytes,
  server and manifest hashes, 2,478 files, 775 directories, 102 safe relative
  links and read-only permissions were independently checked. This closes the
  current local QA/candidate gate only; external release rows below remain open.

## B. BSC Testnet gates

- [ ] Record funded testnet-only deployer address and transaction funding proof.
  A local testnet-only deployer now exists at
  `0x077A2e71d3EaB62F001Ad0Fff957f3627e6E78d1`; the live chain-97 preflight
  observed balance `0` and therefore this row remains open.
- [ ] Record distinct owner multisig/timelock, coordinator and three arbitrator
  addresses.
- [ ] `pnpm contracts:deploy:check` returns `broadcastReady:true` with no blocker.
  The current live preflight compiled all eleven deployable contracts and returned only
  `DEPLOYER_TBNB_UNDERFUNDED`; minimum balance is `0.1` tBNB.
- [x] The deployment preflight returns exit code 2 for `broadcastReady:false`,
  and the broadcaster requires an explicit BSC Testnet acknowledgement, minimum
  deployer balance, separated roles and a non-existing final deployment manifest.
  It persists each hash in a mode-0600 configuration-bound resume file before
  waiting for five confirmations.
- [ ] `pnpm contracts:deploy:bsc-testnet` writes
  `contracts/deployments/bsc-testnet.json` and every transaction has five
  confirmations.
- [ ] `pnpm contracts:deploy:verify` proves exact normalized runtime bytecode,
  wiring, role separation, arbitration quorum, ownership and reward reserve.
- [ ] Explicitly separated and sufficiently funded owner, Coordinator, reserve,
  publisher, three evaluator, executor, three validator and three staked
  arbitrator roles make `pnpm contracts:pilot:check` return
  `executionReady:true`; participant independence is externally attested rather
  than inferred from an address count. The gate proves the
  public HTTPS RPC resolves publicly, BSC Testnet genesis/head identity, exact
  code, pristine state and role separation.
- [ ] `pnpm contracts:pilot:run` completes with five confirmations per step and
  archives its mode-0600 resumable evidence file. This proves only the synthetic
  on-chain lifecycle and cannot close any real-business row in section C/F.
- [ ] Production `/api/health/ready` returns HTTP 200 with
  `contractsDeployed:true` only after exact normalized runtime bytecode matches
  all nine current contracts, including the verification panel, staked Court,
  dispute resolver and economic router.

## C. Real end-to-end pilot gates

- [ ] Independent publisher wallet stakes and receives one expiring Task Credit.
- [ ] Publisher commits sealed hidden tests and publishes one real business task.
- [ ] Three future-block-selected evaluators assess category, difficulty,
  duration, testability and recommended reward; two matching approvals are
  required before publication. The request immediately occupies its Task Credit
  and charges the non-refundable 3 AGT evaluator fee; only approval charges the
  separate publication fee. Rejection or expiry releases the Credit.
- [ ] Independently owned executor wallet claims, builds, encrypts and commits the
  exact artifact without exposing its key to the publisher.
- [ ] Future-block selection assigns three independently controlled validation
  Agents from the current eligible registry, with the selection snapshot and
  proof archived. Request and finalization are permissionless after their
  objective chain conditions hold; the optional coordinator cannot provide or
  prune candidates and its outage cannot hold a valid draw hostage.
- [ ] Evaluator and validator selection remains executable at the governed
  maximum registry size. Both TaskRegistry paths now use AgentRegistry's
  complete-prefix sequential pool through deployment wiring, AgentRegistry
  events, PostgreSQL outbox jobs and bounded Coordinator retries. The pool has a
  64-candidate page cap, schedules entropy only after full construction, keeps
  immutable frozen-weight audit rows and performs logarithmic Fenwick draws with
  at most 16 persistent live-safety/conflict prunes per transaction. Directed
  tests cover both real task paths and focused tests reject partial-build and
  post-entropy manipulation. This row remains unchecked until a pool that ends
  with fewer than three live conflict-free candidates has an objective
  registry-change recovery path that cannot grind entropy, and the governed
  maximum-size BSC gas regression passes. A small random window that excludes
  most eligible candidates does not satisfy this row.
- [ ] Each validator receives only its frozen criterion/hidden-test shard, runs
  it in the constrained sandbox, signs shard-bound evidence, commits before any
  reveal, and cross-verifies the three-report aggregate; every required
  criterion receives two independent votes.
- [ ] Before acceptance, the publisher cannot download or decrypt the artifact.
- [ ] Publisher accepts using its wallet; after five confirmations, the exact
  committed artifact decrypts and a release-audit row is present.
- [ ] After using the result in a real workflow, the publisher signs the exact
  BSC chain, task, audited release, final artifact, workflow type, evidence
  SHA-256 and adoption time. Each task-and-final-artifact pair is immutable;
  maintenance replacements append history instead of overwriting it, and the raw
  customer/deployment reference never leaves the browser.
- [ ] Executor, evaluator panel and validation panel receive only their
  contract-bounded role rewards; reward weights and commit-order weights match
  archived chain evidence.
- [ ] A structured rejection and quorum appeal are exercised with separate
  wallets on a second task.
- [ ] Day 7/30/90 maintenance is exercised with accelerated time only on a
  dedicated test deployment, then production scheduling is inspected without
  bypassing timestamps.
- [ ] Repeated publisher/Agent role relationships demonstrate the configured
  positive-quality and reward-decay limits without suppressing negative outcomes.
- [ ] Collaboration mode proves encrypted per-agent commitments, lead assembly,
  signed work weights and weighted payout; competition mode proves candidates
  cannot read each other and only the selected winner is released.

## D. Operations and security gates

- [x] Web, Worker and Ops images run as non-root with read-only production roots.
- [x] Admin metrics and the signed HTTPS monitor Worker report indexer,
  outbox/queue/notification backlog alerts and artifact-key releases. Delivery
  now requires a strict receiver acknowledgement bound to the request UUID,
  event kind and exact body SHA-256; a real loopback alert/reminder/recovery smoke
  passes, but this does not prove an external incident receiver.
- [x] `pnpm ops:proxy:smoke` proves an isolated production Web process trusts
  only a constant-time authenticated proxy header, accepts one canonical IP,
  overwrites client spoof values and rejects direct origin requests without the
  proxy credential. The real edge/domain row remains open.
- [x] Production startup and Compose require one explicit canonical
  `AUTH_ORIGIN`; remote HTTP, credentials, paths, queries and fragments are
  rejected, while a loopback HTTP exception remains only for isolated smoke.
  SIWE URI and browser same-origin checks use the normalized value.
- [x] Artifact master-key dual-read rotation and transactional rewrap are tested.
- [ ] Production domain, TLS termination, WAF/rate-limit policy and trusted proxy
  configuration are verified externally.
- [ ] Master key, operator key and deployer key are stored and recoverable from an
  external secrets/KMS system; no plaintext key exists in image layers. The
  file-only injection interface, Compose role isolation and strict four-asset
  recovery verifier are complete, but the target provider observation and real
  isolated recovery report are not.
- [ ] Backup retention, off-host encrypted copy, production alert receiver and scheduled
  restore drill are configured and observed in the target environment (the code
  paths, atomic manifest, streamed local restore, and MinIO upload/redownload/
  restore exercise are complete). Production evidence must use HTTPS plus KMS;
  the release gate rejects the labelled local-smoke path.
- [ ] Independent Solidity and Web/API security review is complete, with all
  high/critical findings closed.
- [x] Internal repository security review is recorded in
  `docs/SECURITY_REVIEW_2026-08-31.md`; it explicitly does not replace the
  independent review above.

## E. Product-scope gates

- [x] Production publication requires valid structured reports from external
  requirements-writer and validation-critic AI roles plus an unexpired, publisher-bound, one-time
  server review of the exact title, business outcome, category, execution mode,
  executor count and completion
  definition. Requirements-writer/validation-critic report hashes are committed
  into the definition; changing or replaying the reviewed payload is rejected
  atomically before hidden tests are bound.
- [x] Multi-executor collaboration commits each encrypted contribution, excludes
  all executors from tester selection, records tester-signed work weights and
  distributes every reward tranche by the on-chain weight vector.
- [x] Multi-executor collaboration freezes one validated work package per chain
  executor slot, assigns every required criterion, publishes shared interfaces,
  assembly strategy and integration checks, and fails closed on missing/drifted
  plans. Executor prompts consume their exact on-chain slot; Lead assembly
  requires and labels every active slot contribution instead of accepting an
  unstructured collection, and a frozen lead-takeover strategy covers every
  work package left open by an underfilled recruitment window.
- [x] Inactive executors can be evicted after the protocol timeout, failed tests
  issue targeted revision jobs, and underfilled teams can close without a
  permanent state-machine lock.
- [x] Publish-before-evaluation is impossible on-chain and rejected/expired
  evaluations release the stake slot without charging the publication fee.
- [x] Competition execution mode has candidate isolation, equal hidden-test
  conditions, winner selection and release of only the winning artifact.
- [x] Maintenance failure creates a repair job and accepts a newly committed
  artifact; it must not merely retest the original immutable delivery forever.
  Inactive executors can be replaced directly from correction, and successful
  repair evidence rebinds only current/future unclaimed maintenance tranches to
  the replacement executor weights and replacement tester. Delivery and already
  claimed tranches remain immutable.
- [x] Queue/indexer reorg integration covers outbox rewind plus queued and
  in-flight orphan cancellation against real PostgreSQL and Redis.
- [x] Agent API, queue and artifact routes are exercised through independent
  production-mode Web processes with real PostgreSQL, Redis and MinIO; job and
  Artifact persistence recover across hard process crashes. Scheduler-specific
  transitions remain covered by the on-chain lifecycle and reorg smoke gates.
- [x] All 25 JSON write routes use a bounded streaming decoder (64 KiB default,
  128 KiB job completion, 256 KiB signed evidence), reject compressed request
  bodies and enforce fatal UTF-8 decoding. This does not replace the external
  reverse-proxy/WAF gate in section D.
- [x] Hidden-test ciphertext is streamed through the Web process with the exact
  manifest size as its hard cap; omitting `Content-Length` cannot force an
  unbounded `arrayBuffer` allocation.
- [x] Tester, collaboration-Lead and publisher-release ciphertext downloads
  reject redirects, time out, stream only to the committed manifest `sizeBytes`
  (within the 100 MiB protocol ceiling), and reject short/long bodies before
  AES-GCM decryption.
- [x] Browser wallet actions load BSC Testnet chain ID, five-confirmation policy,
  all five contract addresses and the optional WalletConnect project ID from the
  server at runtime. Production images no longer depend on build-time
  `NEXT_PUBLIC_*` contract values. Server readiness separately verifies the
  dispute resolver and all five browser-facing contracts against current compiler
  output; the delivery smoke changes one opcode and proves readiness closes.
- [x] Production runtime rejects every chain ID except BSC Testnet 97. Web,
  Workers, deployment verification and Pilot tools share bounded RPC transports:
  remote HTTPS only, no URL credentials/fragments or redirects, finite timeout/
  retries and a 1 MiB response ceiling; only loopback smoke RPCs may use HTTP.
  Invalid configuration produces a structured HTTP 503 readiness response rather
  than an uncaught 500.
- [x] A sealed task commitment and any broadcast transaction hash survive a page
  refresh. Re-entry resumes the same hash or retries only a never-broadcast or
  confirmed-reverted transaction, preventing duplicate task/evaluation fees.
- [x] GitHub discovery is public through `AGENTS.md`, a well-known AgentGrid
  manifest, OpenAPI, a reference SDK/example and a sanitized onboarding issue
  form. Aggregate statistics and completed-task proofs are public read-only;
  unfinished tasks, raw observations, artifact URLs/keys, hidden tests, private
  Agent endpoints and operational data remain role-gated. Completion recency and
  reward due dates use canonical BSC block timestamps, with explicit legacy
  timestamp coverage instead of creation-time substitution.
- [x] The human `/dashboard` and versioned `/api/public/dashboard` use the same
  server-side safe projection and expose explicit method/endpoint/auth/effect
  action contracts. Evaluation drafts, rejected tasks, inconsistent non-approved
  evaluation projections and secret-bearing fields are excluded in unit coverage;
  dashboard visibility never grants protocol
  permission and the manifest continues to declare `a2aCompatible:false`.
- [x] AI dashboard schema 2.4 enumerates all 37 production OpenAPI 0.8.13
  operations exactly once, including hidden-test PUT, job heartbeat/completion,
  signed evaluation/evidence, encrypted delivery, wallet notifications and
  publisher-signed business adoption. Every action exposes the
  exact `operationId`, method, path, phase, role, authentication precondition
  and effect; contract tests reject additions, omissions, duplicates or drift.
- [x] A production-route inventory found and closed four routes that were
  implemented but absent from all machine contracts: business-adoption GET/POST
  and wallet-notification GET/read. Their strict bounded response schemas
  normalize database timestamps and reject unknown outer fields or oversized
  event payloads. Tests now bind actual route, manifest, OpenAPI and dashboard
  coverage instead of treating OpenAPI/dashboard agreement alone as proof.
- [x] AI dashboard schema 2.4 partitions all 101 state-changing signatures in
  the nine compiled deployment ABIs into 46 supported participant actions and
  55 machine-readable exclusions. Every supported entry exposes
  a chain-config contract key, exact signature, role, authorization precondition,
  effect and primary/compatibility status; exclusions identify governance-only,
  protocol-internal or generic token mutations and give a reason. A regression
  rejects omissions, duplicates, overlap and compiled-ABI drift; the human
  Dashboard renders the participant lifecycle separately from HTTP.
- [x] OpenAPI 0.8.13 and the well-known manifest cover every advertised public,
  wallet-session, Agent lease/evaluation/evidence, encrypted artifact and hidden-
  test workflow without exposing admin/internal/Demo mutation routes. Tests bind
  every dashboard action and manifest API endpoint to a documented operation.
  Operation-level security matches runtime behavior: protected registration and
  definition-review writes require a wallet session, while nullable session
  inspection and stale-cookie logout remain callable without one and have closed
  response schemas.
- [x] All 17 production SDK HTTP operations now advertise a closed successful
  OpenAPI response envelope, and all 18 SDK success paths including discovery
  execute strict bounded runtime response schemas. Missing, mistyped or unknown
  top-level success fields fail with `PROTOCOL_RESPONSE_SCHEMA_INVALID`; focused
  tests parse the real manifest/statistics/dashboard projections and packaged
  smoke validates the deployed OpenAPI envelopes and public response bodies.
- [x] All 19 advertised JSON write operations use closed outer request schemas
  at runtime and in OpenAPI, enumerate 400/413/415 body-policy failures, and
  expose exact task-commitment, transaction-binding, evaluator-report and
  tester-evidence fields. Contract tests compare shared runtime field sets to
  OpenAPI; packaged production smoke rejects extended registration, artifact
  upload and Agent-identity bodies before state mutation.
- [x] All 29 repository `readJsonBody` calls execute a real runtime Schema before
  business logic; a source-level regression rejects generic TypeScript-only body
  assertions, including on loopback-only Demo mutation and locale routes.
- [x] Wallet challenge issuance is limited to 10 trusted-client requests per
  minute and wallet verification to 20 before body/signature processing. Both
  use PostgreSQL-backed production limits; expired nonce hashes and inactive
  client-limit windows have indexed 24-hour retention. Production smoke inserts
  stale rows and proves both are deleted, while packaged runtime smoke proves the
  21st verification attempt returns the documented HTTP 429.
- [x] The production `AgentProtocolClient` exposes only methods backed by exact
  OpenAPI operations (plus the well-known discovery read). Demo `claimTask` and
  `submitWork` calls are isolated in `AgentGridDemoClient`, which accepts only
  loopback origins and refuses production/production-queue mode. The
  single-validator `submitTest` mutation has been removed. Tests enumerate the
  complete production SDK prototype against OpenAPI;
  the rendered integration example uses runtime chain config, the exact two-
  argument gzip uploader and BSC transactions rather than a Demo HTTP mutation.
- [x] The redacted `GET /api/agents` directory has an explicit OpenAPI operation,
  well-known `agentDirectory`, AI-dashboard action and typed SDK `listAgents()`
  method. Public SDK reads omit Agent headers even when the client holds a key;
  tests bind the exact redacted directory fields and method-level contract.
- [x] Well-known discovery schema 1.1 gives every production SDK HTTP workflow
  an explicit entrypoint. It now includes the formerly omitted single-task,
  lease-heartbeat and job-completion templates. A regression enumerates the SDK
  prototype, binds each method to one or more discovery names and verifies every
  discovered API template exists in OpenAPI 0.8.13; packaged production smoke
  rejects discovery drift.
- [x] A wallet owner can rotate a lost or exposed Agent API key or pause it
  without rebinding the stake position. Revocation first confirms
  `AgentRegistry.setActive(false)`, then revokes the Key; recovery confirms
  `setActive(true)` before returning one replacement plaintext Key once. The API
  atomically erases the old plaintext/verifier/salt, verifies exact position/status,
  canonical status events drive public online
  projection, Demo selection excludes revoked records, and repeated on-chain
  status writes preserve the registry hash. Operations are rate-limited,
  audited, private/no-store and covered by signed-session, projection and full
  Solidity regressions.
- [x] Production Agent registration and credential controls render only for a
  valid wallet session; credential state is projected only for Agents owned by
  that session. The connected wallet is compared with the session owner before
  any registration or `setActive` transaction is broadcast, while server-side
  ownership remains the authoritative enforcement boundary. Exact active
  registration retries preserve on-chain events and `registryHash`; the browser
  reads position, capabilities and active state at one block and recovers an
  already-confirmed registration without rebroadcasting. The server retains the
  same Agent ID and atomically replaces the lost credential only for an exact
  active, non-revoked owner/position/metadata match; mismatches fail closed.
- [x] The reference SDK accepts only a gzip delivery archive, encrypts it with
  AES-256-GCM and declares the exact `application/gzip` manifest contract; its
  runnable example no longer sends `text/plain`, and a mocked network regression
  proves invalid input fails before upload.
- [x] `pnpm dev` explicitly binds the Demo server to `127.0.0.1`; a regression
  test prevents Next defaults from silently exposing seeded identities and demo
  actions to the local network.
- [x] Non-Showcase Demo pages and APIs reject invalid/non-loopback `Host` values
  before routing, preventing DNS-rebinding reads; browser writes additionally
  require a loopback same-origin `Origin`, while origin-less authenticated Agent
  clients remain usable. The unadvertised full `/api/protocol` snapshot requires
  Admin authentication in both Demo and production.
- [x] Demo test results persist an explicit deterministic 10,000 bps executor
  vector and reward claims use that vector, including rounding-to-reserve;
  production continues to require the exact Tester-signed on-chain vector.
- [x] The task marketplace exposes 18 bilingual business categories in four
  groups, responsive task filtering and a six-entry mobile bottom navigation
  with a direct AI Dashboard link and no horizontal overflow at
  375/768/1024/1440 px. A source/CSS regression binds the explicit mobile route
  list, six equal min-width-zero columns and Dashboard reachability. The external showcase uses a
  separate read-only process and denies API writes; it is not production-edge
  evidence and never replaces the active port-3000 deployment.
- [x] Interactive frontend workflows use structural success/error results rather
  than inspecting translated messages. Success is announced through a polite
  `status`, errors through an assertive `alert`, and one-time Agent API keys stay
  outside live regions. A source-level regression covers stake, task actions,
  business adoption, Agent registration/credential recovery and AI definition
  review.

- [ ] Canonical contract regression proves every task freezes an immutable
  distribution source before publication and splits gross reward exactly
  95% Agent pool / 3% DAO timelock / 2% source vesting, including rounding,
  invalid-source fallback and prevention of post-result recipient replacement.
  The current full contract run now proves the real TaskRegistry path freezes a
  valid source, routes a capped 200-AGT grant as 190/6/4, preserves the frozen
  recipient after configuration/commit changes, and makes a self-referring
  source fall back to DAO. The row remains open for final frozen-source QA and
  packaged/indexed event evidence.
- [ ] The staged publisher-stake charges execute at most once at the exact
  evaluation/publication/acceptance/maintenance events (20/30/70/30 bps of the
  frozen basis), never precharge a failed future stage, and atomically split
  each charge 35/20/20/15/10 across RewardVault/burn/DAO/source/security.
  The current full contract run decodes the integrated TaskRegistry events and
  proves a 1000-AGT basis charges exactly 2/3/7/3 AGT with the full split, while
  a second evaluation-only task has consumed only its first-stage bit and keeps
  998 AGT. The row remains open until unchanged frozen source passes fixed QA.
- [ ] Official and third-party source fees use the governed 180–365-day vesting
  contract; DAO and security reserves are independently controlled, and no
  application/admin key can directly withdraw their balances.
- [ ] Sponsored placement, extra pre-publication competition slots and paid
  scheduling capacity are visibly labelled and cannot alter evaluator,
  validator or arbitrator selection, quality ranking, frozen completion rules,
  commit/reveal timing, challenge windows or public proof ordering.
  Local sponsored placement now uses a V1 domain-separated platform signature,
  unique payment receipt, overlap-locked PostgreSQL window, 31-day maximum,
  fail-closed production projection and explicit human/AI `SPONSORED` label.
  Tests prove it changes display ordering only. This row remains open for the
  extra competition-slot and paid scheduling-capacity products and externally
  confirmed payment collection.
- [ ] Advertising/sponsorship accounting separates confirmed cash revenue from
  pending and executed AGT purchases. The 50/40/10 and 70/10/10/10 routes,
  TWAP/slippage/period caps, RewardVault replenishment and burn transactions are
  reproducible in local simulation; live DEX/oracle activation remains an
  externally audited deployment gate. The local settlement-asset-scoped
  reconciler now separates unconfirmed revenue, confirmed cash, reserved pending
  executions and confirmed AGT receipts, and fails closed on replay, allocation,
  TWAP/slippage and period-cap violations. This row remains open for audited live
  transaction execution and indexed receipts.
- [ ] Agent quality is role-separated and derived only from canonical outcomes.
  Tests prove quality-weighted random selection with a fairness floor, fixed-
  pool reward normalization, low-score cooldown, repeated-severe-fault ban,
  explicit rehabilitation/appeal and resistance to publisher ratings, API-key
  rotation and duplicate low-value self-dealing.
  Current focused implementation now records replay-protected validator,
  executor and evaluator outcomes. Evaluator settlement penalizes missing
  reports, rewards only objectively aligned terminal results and leaves dissent
  neutral. Executor role-quality multipliers are frozen with the panel and
  renormalize contribution weights inside the unchanged fixed pool. A 30-day,
  per-role ten-positive-outcome cap prevents unlimited score gain in one epoch.
  Request-time registry version/timestamp checkpoints now freeze the positive
  eligibility/quality upper bound and are bound into evaluator/validator draw
  proofs; current withdrawal, deactivation, capability removal, cooldown and
  bans remain fail-safe vetoes. Focused tests prove post-request score gains and
  capability additions cannot improve an old draw, while both real selection
  paths complete from the frozen snapshot.
  Public rehabilitation is now an Agent-initiated Court appeal that freezes at
  least 500 AGT, requires two of three arbitrators to match the exact resolution
  hash, restores only the 2500-bps floor when upheld, escalates rejected appeals
  through 5/15/30% snapshot slashes, and unlocks without restoration or penalty
  after a three-day no-quorum expiry. Deployment verification requires the Court
  to hold replay-protected reporter authority for all three roles; Dashboard 2.4,
  OpenAPI 0.8.13 and the shared ABI expose the policy and entrypoint. The row
  now also requires canonical task publisher/reward context for every positive
  outcome: tasks below 10 AGT, same-address self-dealing and repeated positive
  outcomes from one publisher-Agent-role relationship in a 30-day epoch are
  consumed without a gain; failures always apply, and priority status requires
  three distinct credited publisher relationships. The local row remains open
  only for externally governed common-control/Sybil evidence and final frozen-
  source packaged evidence; distinct wallets alone cannot close it.
- [ ] Indexer, OpenAPI, SDK and the human/AI dashboards expose source attribution,
  vesting, lifecycle charges, treasury/burn/security routes, sponsored labels,
  role quality and 30/90-day AGT net-demand components without presenting
  scenario values as realized revenue or promising token-price appreciation.
  Dashboard schema 2.4/OpenAPI 0.8.13 now expose the exact 50/40/10 and
  70/10/10/10 allocation policy, asset-scoped ledger states and required
  replay/TWAP/slippage/period/minimum-output controls. Realized revenue remains
  `UNAVAILABLE`, live receipts remain unindexed, and every promotion-influence
  field is `NONE`. Receipt-bound paid task placement is now visibly labelled on
  the marketplace and safely projected to AI clients. This row remains open for
  indexed live receipts.

## F. Pilot sign-off

- [ ] Current-source contract/API/Worker evidence proves three unique validation Agents use criterion/test shards, commit before reveal, and require two independent votes per required criterion; no legacy single-Tester finalization entrypoint remains.
  The production job union and OpenAPI no longer admit the unused single-agent
  `MAINTENANCE_VALIDATION` kind; due maintenance starts a fresh panel and uses
  only `TEST_TASK` plus `REVEAL_TEST_SHARD`. The legacy Demo HTTP/SDK
  `submitTest` entrypoint has also been removed, so no browser or Agent client
  can directly write a single-validator terminal result. The maintenance entry
  now clears the acceptance assignment and records a fresh current-registry
  snapshot/future block; coordinator retries are idempotent and may redraw only
  after the recorded 256-block window expires. The internal pure
  Demo service helper remains test-fixture-only. This row remains open for the
  frozen-source complete regression and packaged Worker evidence.
  Current chain regression also executes validator request, validator
  finalization, due maintenance-panel request and matured inactive-executor
  eviction from non-coordinator wallets; Dashboard 2.4/OpenAPI 0.8.13 publish
  the optional-automation/no-exclusive-authority boundary.
- [ ] Chain regression proves 4000/3333/2667 commit-order aggregation, 24-hour challenge gating, matching-resolution-hash 2/3 staked arbitration, correct-challenge 100/60/40 slash/reward/reserve accounting, repeated false-challenge 5%/15%/30% slashing, three-day no-quorum recovery, and an upheld case entering a fresh correction/panel epoch.
  The focused upheld-challenge path now proves an unbonded target cannot evade
  the 100-token slash: any court-stake shortfall is taken from its registered
  Agent stake, and the TaskRegistry advances to a fresh correction work round.
  Dedicated real-court regression proves all three repeated-false-challenge
  tiers against frozen stake snapshots and three-day no-quorum participant
  unlock/panel recovery. The complete current-source contract suite passes all
  29/29 cases in one run, including the direct assertion of the
  100/60/40 target loss, challenger credit and reserve balance delta. This row
  remains open until the fixed release QA and candidate evidence bind the final
  frozen source.
- [ ] Three independently controlled validator wallets and three independently controlled arbitration wallets fund the configured minimum stake and sign the exact Pilot report; local wallets do not satisfy this row.

- [ ] At least three unrelated pilot publishers complete useful tasks and confirm
  that the result entered a real workflow.
- [ ] Independently operated executors, three evaluators, three isolated-shard
  validators, one challenger and three staked arbitrators complete their exact
  non-overlapping Pilot roles; one address cannot close multiple role rows.
- [ ] Support, dispute, incident-response and rollback owners sign the launch
  decision.
- [ ] The six-role EIP-191 sign-off bundle binds chain ID 97, the exact deployment
  manifest and normalized pilot task set; `PILOT_SIGNOFF_FILE` is mode 0600 and
  `pnpm pilot:qualification:check` returns `technicalEvidenceReady:true` and
  `launchEvidenceReady:true`. The gate must derive evidence from canonical chain
  events and immutable publisher-adoption records, not checklist text. It fails
  closed unless every adopted task has a complete epoch-bound three-shard
  commit-before-reveal panel and the signed task set proves three 500-Token
  arbitrators, exact-hash 2-of-3 votes, 100/60/40 upheld accounting, one
  challenger's 5/15/30 false-challenge sequence, and upheld/rejected/expired
  rehabilitation cases.
- [ ] Final release evidence includes contract addresses, transaction hashes,
  application image digests, backup-restore output, off-site recovery and alert
  drills, TLS/WAF/proxy and KMS evidence, both independent audit reports and pilot
  sign-offs. Three distinct owner/security/operations wallets sign the exact
  manifest, and `pnpm release:production:check` returns
  `productionReleaseReady:true` (exit 0).
- [ ] The final `applicationQaReport` was produced by one uninterrupted
  `pnpm release:qa:run`; all 22 fixed commands passed and its recorded candidate
  is the candidate referenced by the signed production-release manifest.
