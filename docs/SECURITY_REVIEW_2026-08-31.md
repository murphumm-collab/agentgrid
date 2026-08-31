# AgentGrid candidate security review — 2026-08-31

## Executive summary

This is an internal, repository-grounded review of the current candidate source;
it is not an independent audit and does not approve public launch. No unresolved
critical issue was identified. Two high-risk implementation defects found during
this development cycle—execution of orphaned chain-event jobs after a reorg and
unrestricted forwarding of decrypted collaboration artifacts to an AI provider—
are fixed and covered by focused tests/smoke exercises. A backup credential leak
through process arguments and deterministic reward-padding exposure were also
reduced in the candidate.

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
  a provider response body in error messages. Tests cover missing/wrong origins,
  cleartext remote endpoints, embedded credentials, and the localhost exception.
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
  `contracts/scripts/pilot-preflight.ts`
- **Evidence:** The compiler now preserves every Solidity immutable reference.
  Deployment verification and pilot preflight normalize only those declared byte
  ranges, then require the remaining on-chain runtime bytecode to equal current
  compiler output exactly. Focused tests prove immutable values may differ while
  any other opcode change fails. Contract lifecycle setup verifies the five core
  locally deployed runtimes through the same function. Future manifests include
  solc version and normalized runtime hashes.
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
  coordinator can evict an executor who has not committed in the current work
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

## Verified controls and limitations

- Dependency audit most recently reported no known production vulnerabilities;
  this must be rerun for every candidate lockfile.
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
