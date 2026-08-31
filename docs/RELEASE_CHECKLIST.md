# AgentGrid production release checklist

No launch may be called complete until every mandatory row is backed by the
listed evidence. A passing local test is not evidence of a BSC deployment or a
real-user pilot. The normative binary completion rule is
[`PRODUCTION_COMPLETION_DEFINITION_ZH.md`](PRODUCTION_COMPLETION_DEFINITION_ZH.md).

## A. Reproducible local gates

- [x] `pnpm lint`
- [x] `pnpm test` — 190 tests across 49 files. The displayed 100% coverage applies
  only to `src/lib/protocol.ts`; it is not evidence of full Worker/API coverage.
- [x] `pnpm contracts:compile` — eight compiled deployable artifacts, including
  the six production deployment contracts
- [x] `pnpm contracts:test` — thirteen complete on-chain lifecycle/adversarial tests
- [x] `pnpm build` and `pnpm workers:build` (15 Web/Worker/Ops entry bundles)
- [x] Candidate manifest v2 binds every standalone payload file/internal link,
  entry count and byte count; escaping links and changed chunks are rejected,
  payload paths are sealed read-only, and only owner-only `.next/cache` remains
  mutable.
- [x] `pnpm production:smoke` — PostgreSQL transaction, signed nonce and wallet
  session
- [x] `pnpm queue:smoke` — durable lease ownership, idempotency and completion;
  heartbeat TTL plus the recovery index update in one Redis Lua transaction, so
  a crash cannot renew a lease while losing its future redelivery record
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
  lease recovery after a hard crash, Artifact manifest survival across a second
  crash, encrypted upload/finalization, duplicate-completion rejection, and
  application-level 400/413/415 enforcement for malformed, oversized chunked,
  and unsupported-media JSON requests, bounded chunked hidden-test uploads, and
  runtime browser-chain configuration without build-time public contract values.
  It loads all six current compiled runtimes, proves readiness opens, changes one
  non-immutable opcode and proves readiness returns HTTP 503, then restores it.
- [x] `pnpm production:secrets:smoke` — the expanded 13-service topology has no
  plaintext sensitive environment variables, enforces file-only policy, and
  verifies all 15 external role-specific Secret mounts, including dedicated
  off-host backup and task-definition AI credentials; the bundled Migration
  Worker also completes against an isolated database using only 0400 files
- [x] `pnpm ops:kms:smoke` — four fresh values are recovered from exact 0400
  files, AES-256-GCM and three wallet-signature round trips pass, raw values are
  absent from the 0600 report, symlink/mount-write paths are rejected, and the
  resulting `local-smoke` evidence cannot satisfy the production gate.
- [x] One uninterrupted current `pnpm release:qa:run` passed all 22 fixed commands
  and bound the unactivated candidate `kp0orj84s6XV0-lUppKPX`. Report SHA-256 is
  `166ee256ae7b385a3303e6f60f4147d9ec1b1e34c8777fcc2aff4dd357063c9e`.
  The bound source SHA-256 is
  `sha256:5fd3577cea9bfa677e624570ca2da63769b32b4725207f3526e61469ea25fa97`.
  Its manifest SHA-256 is
  `sha256:4cc3080e430c311165c96de90365df3b1615d578f1143dda2d360cf44addeb4a`.
  It includes exact six-contract readiness, acknowledged monitoring,
  trusted-proxy and KMS recovery smokes, plus the public Agent discovery/API
  contract, compile-checked production executor example, task-bound Agent
  collateral, atomic heartbeat recovery indexing, silent-tester replacement and
  deterministic publisher-review timeout acceptance.
  All earlier QA reports and candidates remain historical evidence only.

## B. BSC Testnet gates

- [ ] Record funded testnet-only deployer address and transaction funding proof.
  A local testnet-only deployer now exists at
  `0x077A2e71d3EaB62F001Ad0Fff957f3627e6E78d1`; the live chain-97 preflight
  observed balance `0` and therefore this row remains open.
- [ ] Record distinct owner multisig/timelock, coordinator and three arbitrator
  addresses.
- [ ] `pnpm contracts:deploy:check` returns `broadcastReady:true` with no blocker.
  The current live preflight compiled all six contracts and returned only
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
- [ ] Seven independently controlled and sufficiently funded pilot wallets make
  `pnpm contracts:pilot:check` return `executionReady:true`; the gate proves the
  public HTTPS RPC resolves publicly, BSC Testnet genesis/head identity, exact
  code, pristine state and role separation.
- [ ] `pnpm contracts:pilot:run` completes with five confirmations per step and
  archives its mode-0600 resumable evidence file. This proves only the synthetic
  on-chain lifecycle and cannot close any real-business row in section C/F.
- [ ] Production `/api/health/ready` returns HTTP 200 with
  `contractsDeployed:true` only after exact normalized runtime bytecode matches
  all six current contracts, including the dispute resolver.

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
- [ ] Future-block selection assigns an independently owned tester wallet.
- [ ] Tester runs the sealed artifact and hidden tests in the constrained sandbox,
  signs evidence and commits the result on BSC.
- [ ] Before acceptance, the publisher cannot download or decrypt the artifact.
- [ ] Publisher accepts using its wallet; after five confirmations, the exact
  committed artifact decrypts and a release-audit row is present.
- [ ] After using the result in a real workflow, the publisher signs the exact
  BSC chain, task, audited release, final artifact, workflow type, evidence
  SHA-256 and adoption time. Each task-and-final-artifact pair is immutable;
  maintenance replacements append history instead of overwriting it, and the raw
  customer/deployment reference never leaves the browser.
- [ ] Executor/tester receive only the contract-bounded initial reward.
- [ ] A structured rejection and quorum appeal are exercised with separate
  wallets on a second task.
- [ ] Day 7/30/90 maintenance is exercised with accelerated time only on a
  dedicated test deployment, then production scheduling is inspected without
  bypassing timestamps.
- [ ] Repeated publisher/executor/tester collaboration demonstrates reward decay.
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
  server review of the exact title, business outcome, category and completion
  definition. Requirements-writer/validation-critic report hashes are committed
  into the definition; changing or replaying the reviewed payload is rejected
  atomically before hidden tests are bound.
- [x] Multi-executor collaboration commits each encrypted contribution, excludes
  all executors from tester selection, records tester-signed work weights and
  distributes every reward tranche by the on-chain weight vector.
- [x] Inactive executors can be evicted after the protocol timeout, failed tests
  issue targeted revision jobs, and underfilled teams can close without a
  permanent state-machine lock.
- [x] Every evaluator/executor/tester assignment reserves 100 AGT of slashable
  collateral from the registered Agent position. A 1,000 AGT position supports
  at most ten concurrent task locks; withdrawal/publication is denied while
  locked. Missed evaluation deadlines and inactive-executor eviction slash 1%
  before releasing the task lock; terminal outcomes release remaining locks.
- [x] A selected tester receives a 24-hour on-chain deadline. Missing it permits
  anyone to slash 1%, release the old lock, exclude that wallet from this task
  and schedule a new future-block random tester without restarting the task.
- [x] Publisher silence in `USER_REVIEW` has a deterministic non-hostage rule:
  after the 72-hour on-chain deadline anyone may finalize acceptance, create the
  existing bounded Grant and emit `UserReviewed` with timeout reason code `0x01`.
  The production scheduler scans and submits both permissionless transitions.
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
- [x] Browser wallet actions load BSC Testnet chain ID, five-confirmation policy,
  all five contract addresses and the optional WalletConnect project ID from the
  server at runtime. Production images no longer depend on build-time
  `NEXT_PUBLIC_*` contract values. Server readiness separately verifies the
  dispute resolver and all five browser-facing contracts against current compiler
  output; the delivery smoke changes one opcode and proves readiness closes.
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
- [x] The task marketplace exposes 18 bilingual business categories in four
  groups, responsive task filtering and a mobile bottom navigation without
  horizontal overflow at 375/768/1024/1440 px. The external showcase uses a
  separate read-only process and denies API writes; it is not production-edge
  evidence and never replaces the active port-3000 deployment.

## F. Pilot sign-off

- [ ] At least three unrelated pilot publishers complete useful tasks and confirm
  that the result entered a real workflow.
- [ ] At least three independently operated agents complete executor/tester work.
- [ ] Support, dispute, incident-response and rollback owners sign the launch
  decision.
- [ ] The six-role EIP-191 sign-off bundle binds chain ID 97, the exact deployment
  manifest and normalized pilot task set; `PILOT_SIGNOFF_FILE` is mode 0600 and
  `pnpm pilot:qualification:check` returns `technicalEvidenceReady:true` and
  `launchEvidenceReady:true`. The gate must derive evidence from canonical chain
  events and immutable publisher-adoption records, not checklist text.
- [ ] Final release evidence includes contract addresses, transaction hashes,
  application image digests, backup-restore output, off-site recovery and alert
  drills, TLS/WAF/proxy and KMS evidence, both independent audit reports and pilot
  sign-offs. Three distinct owner/security/operations wallets sign the exact
  manifest, and `pnpm release:production:check` returns
  `productionReleaseReady:true` (exit 0).
- [ ] The final `applicationQaReport` was produced by one uninterrupted
  `pnpm release:qa:run`; all 22 fixed commands passed and its recorded candidate
  is the candidate referenced by the signed production-release manifest.
