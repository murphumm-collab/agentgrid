# AgentGrid 24-hour continuous development contract

This document defines the bounded 24-hour Codex heartbeat task named
`AgentGrid 24小时持续开发` (`agentgrid-24`). It wakes the current task once per
hour for 24 occurrences. Each occurrence must make one evidence-backed unit of
progress or report that only external work remains; elapsed time and activity
alone never count as progress.

## Scope processed without user intervention

- Audit and improve the AI-friendly frontend, public safe projection, discovery
  manifest, OpenAPI and reference SDK.
- Audit security, state-machine, contract, API, Worker, data and operations
  behavior against `docs/DEVELOPMENT_RULES_ZH.md`.
- Implement safe repository-local fixes, tests and documentation.
- Run proportionate focused checks after each change and the fixed full release
  QA after the final governed source change.
- Preserve user changes and leave commits, pushes, deployments and production
  mutations to explicit user authorization.

## Definition of done

The automation may report **local delivery complete** only when every condition
below is simultaneously true:

1. Every locally executable mandatory row in `docs/RELEASE_CHECKLIST.md` is
   checked and points to evidence for the current source.
2. Human pages and machine contracts implement the same fail-closed public and
   authorization semantics; no Agent must guess a method, identity requirement,
   effect, unknown value or completion state.
3. The task lifecycle, encrypted delivery boundary, independent evaluation and
   testing, weighted rewards, dispute/repair path and maintenance checkpoints
   remain aligned across Solidity, projection, storage, API, Worker, SDK, UI and
   documentation.
4. Type checking, lint, the complete unit suite, Worker build, production Web
   build, contract compilation/regression and every local runtime smoke pass.
5. After the last governed source change, one uninterrupted fixed 22-command
   `release:qa:run` passes against unchanged source.
6. The QA report, source SHA-256, build ID, read-only candidate payload and
   release manifest are cryptographically bound and independently rechecked.
7. The checklist and this document do not cite historical evidence as current.
8. Numeric claims in current candidate, QA, security and checklist evidence are
   traced to current executable assertions or immutable reports and agree across
   documents; superseded counts are not carried forward.

**Public production complete** additionally requires every external item in
`docs/EXTERNAL_COLLABORATION.md` and every remaining release-checklist row. An
automation run must never relabel a local candidate as a public deployment.

## Per-occurrence protocol

1. Inspect the worktree and current evidence; never rely only on the previous
   conversational summary.
2. Read repository instructions and select the highest-impact local gap that is
   safe to complete without new authority.
3. If governed source changes, immediately demote the previous application QA
   evidence to historical status.
4. Implement one coherent change, add a regression test, run focused checks and
   update rules/checklist when product semantics changed.
5. Do not create churn solely to keep the automation busy. When no meaningful
   local work remains, update the external queue and report the exact blocker.

## Current development status

The source frozen at commit `1764c30` has a complete, immutable local
QA/candidate milestone. It became historical when the next governed development
cycle added the paid-capacity entitlement model. One uninterrupted fixed
22-command QA passed for that milestone from
`2026-09-01T23:27:12.427Z` through `2026-09-01T23:50:09.040Z` and binds source
SHA-256 `sha256:8ace26d6ab52599262ca006102bc3873656d2ed8b694bb4b44360ad62edf0fae`
to unactivated candidate `nShHeijb9O7TsJrsHaT6w`. Its 2,582 payload entries /
69,617,131 bytes, payload SHA-256
`sha256:6a250db154efa2c427cefbae4eca5b49e070c09eab8fd5f6823bd10ce73d2e57`,
manifest SHA-256
`sha256:04515d6ccf598efe412fc021350e83fa4818b89b072a04e2a7cc568b054da7b2`
and server SHA-256
`82adb99683348f2e8a036d12e953fd5b011a4925125e2487d318e2ab5337f0ae`
were independently rechecked. The report is mode 0600, the candidate root is
0555 and its manifest is 0444; only the manifest-declared `.next/cache` remains
mutable. The candidate has `activationRequired:true` and has not been deployed.

This milestone does **not** yet satisfy the repository definition of “local
delivery complete”: the first-phase commercial scope still lacks paid extra
competition slots and paid scheduling capacity. Those two products must remain
visibly sponsored and may change only the frozen pre-publication executor-slot
limit or fair queue order; they may not alter evaluator, validator or arbitrator
selection, quality ranking, completion rules, deadlines or challenge windows.
At that milestone the governed source therefore required a new fixed run and candidate
after the two commercial products are fully integrated and frozen.

The next cycle has started with `AgentGrid Paid Capacity Entitlement V1`. Its
strict signed union binds chain 97, TaskRegistry, publisher, issuer, definition
review, final spec hash, unique payment receipt, amount, currency and validity
window. Competition includes two slots and permits 1–30 paid extras up to 32;
the entitlement accurately declares `EXECUTOR_CAPACITY_ONLY`, that recipient
weights may change inside the fixed pool, and that an on-chain pass registry is
still required. Priority scheduling binds the same pre-publication scope and
declares only `EXECUTOR_GENERAL_QUEUE_ORDER_ONLY` plus a required 3:1 fair
application queue. Neither kind may alter criteria, deadlines, evaluator /
validator / arbitrator selection, quality, challenge rules or the reward pool.
The current application regression passes 367/367 tests across 96 files and the
uninterrupted contract regression passes 41/41 across nine files. Compilation
produces 21 deployable contracts; the feature-dense TaskRegistry is 24,575 bytes,
one byte below EIP-170, so any later Solidity edit must re-run the size gate. A standalone EIP-712
`CompetitionSlotPassRegistry` now restricts settlement assets to USDT/USDC/BNB,
prevents authorization/receipt replay, enforces the 2+1..30 slot bounds and lets
only its immutable TaskRegistry consume exact unexpired terms. TaskRegistry now
consumes the exact publisher/spec/slot authorization before allocating a task ID
or mutating credit and fee state; downstream reverts restore the authorization,
and every free, paid or collaboration task emits a slot-freeze proof. PostgreSQL
now imports only fixed-issuer signed priority entitlements, consumes them in the
definition-review/hidden-test/commitment transaction and freezes the first N
eligible executor jobs. Redis uses immutable internal bindings, a global 3:1
priority/standard cursor advanced only by a successful general executor lease,
targeted-job precedence and original-lane recovery. The tenth deployment
contract, runtime verification, chain config, indexer and action inventory are
integrated as internal commercial enforcement: 108 mutable signatures are
partitioned into 46 participant actions and 62 exclusions. OpenAPI 0.8.16, the
strict SDK response and the bilingual Dashboard keep the product visibly
`DOMAIN_MODEL_ONLY`, `available:false`, `participantPurchaseAction:false` with
no purchase endpoint. The final runtime manifest, complete current-source gates,
fixed 22-command QA and candidate binding were then frozen at commit `ee184be`.

Governed application development then resumed to expose the already inventoried
`TestToken.faucet()` action through a dedicated bilingual `/faucet` page. The
BSC Testnet path reads the contract's exact 10,000-tAGT amount, 24-hour cooldown,
last-claim time and caller balance, submits only the connected caller's direct
transaction, waits for governed confirmations, verifies the exact balance delta
and renders its BscScan proof plus next eligible time. It never accepts a
recipient, key or server relay and clearly states that independent tBNB is still
needed for gas. Demo mode is explicitly an off-chain capped ledger and cannot be
mistaken for tAGT. The focused page/eligibility checks, 367-test application
suite, 41-test contract suite, typecheck, lint, compile and production build pass;
the new fixed 22-command QA then passed uninterrupted from
`2026-09-02T04:35:35.214Z` through `2026-09-02T04:58:45.161Z`. Its mode-0600
report at
`/Users/mac/.agentgrid-release-evidence/agentgrid-qa-faucet/application-qa.json`
binds source SHA-256
`sha256:d02d3a73716f392c0f4c51a058b8f01fbce32367d7b44ececa87405631cb93ce`
to unactivated candidate `4Ed2vOYZnFcUrIFnAVCwn`, payload SHA-256
`sha256:4878832ad09299c3771326e30e9e9a341a9c3ee1e47cfa225024fa4bb086a15e`
and manifest SHA-256
`sha256:72a670fe26babc597c3c964852b9ec7d295598cf7f6ac05a46a67c823bf09b88`.
This closed the local-delivery definition for faucet-enabled governed source
commit `d631cb1`. Governed development resumed on 2026-09-02 after confirming
that executor registration and task claiming were still incorrectly stake-gated.
The report and candidate are therefore historical until the zero-stake executor
boundary completes a new uninterrupted fixed QA; public deployment gates remain external.
One uninterrupted run passed all 22 commands from
`2026-09-02T01:37:35.625Z` through `2026-09-02T02:01:06.187Z`; its mode-0600
report binds source SHA-256
`sha256:13cc42019c00dcb662298d8812f7b517276285caabb0d331bc3be355736eff58`
to unactivated candidate `Pb3ElgGhqtgYphGdsAF35`, payload SHA-256
`sha256:decc4b55d84290a3df2e2a7ba74222a0bb006fb704661f6403871d12f8a0e609`
and manifest SHA-256
`sha256:c97c673f3c4d5573542adbfb08ba16eb82fc53327cc90574ac14a7a35799d155`.
This closed the repository's local-delivery definition for that frozen source.
Governed development later resumed for a dedicated caller-paid BSC Testnet
faucet page, so the report and candidate are now historical until the changed
source completes a new uninterrupted fixed QA. Neither candidate authorizes a
public deployment or satisfies the external production launch gates.

Governed development then removed the unintended executor stake dependency.
Pure executors now register capability `1` with position `0`, lease and claim
without AGT stake, but remain wallet-bound and subject to active state, quality
cooldown and bans. Position `0` cannot acquire evaluator, validator or combined
capabilities and cannot enlarge or advance their append-only selection pool; a
later valid stake-backed upgrade joins that pool once. Production authentication,
OpenAPI 0.8.17, discovery 1.2, Dashboard 2.7, the bilingual UI and direct
TaskRegistry eligibility use the same rule. A court-staked zero-position executor
may still use the evidence-bound rehabilitation path without creating a main
Agent stake requirement.

Application tests pass 368/368 across 96 files and contracts pass 43/43 across
9 files. The fixed 22-command QA for frozen governed source commit `b006b23`
passed uninterrupted from `2026-09-02T07:06:38.046Z` through
`2026-09-02T07:30:49.991Z`. Its mode-0600 report at
`/Users/mac/.agentgrid-release-evidence/agentgrid-qa-zero-stake/application-qa.json`
binds source SHA-256
`sha256:ff9c0ed750cd62e5ebc99b1f04b7ecaa2602f15095174dce44f83cda0c333e85`
to unactivated candidate `lf1SmMsTfSnnlit2yh8Gv`, payload SHA-256
`sha256:8a1de97dd149fce08d425913574fc3d9166ff8a70b5ff8f181ec33a32fcaa9d5`
and manifest SHA-256
`sha256:bf85fe6a4269bff665427f6cbc7e83794e7b3b6303e8be2519cbd7492985d0c6`.
The local-delivery definition is closed again for that exact source; public
production remains blocked by the external-authority gates below.

Public production also remains blocked by the external-authority items in
`docs/EXTERNAL_COLLABORATION.md`: repository-owner merge approval, funded/separated
BSC roles, hosting/domain/TLS/WAF, production KMS and off-site recovery, real
independent pilot participants, independent audits and accountable signatures.
No local fixture substitutes for those gates.

The current source also adds `ProtocolEconomics` and is migrating the legacy
fixed evaluation/publication fees to immutable source attribution, 95/3/2 gross
reward routing, DAO/source vesting and idempotent 20/30/70/30-bps lifecycle
charges. Compilation, isolated economics tests, focused lifecycle regressions,
the OpenAPI 0.8.15 machine surface and economics dashboard projection pass locally. The
role-separated quality path now records validator and executor results plus a
permissionless, one-shot evaluator settlement, freezes fixed-pool executor
quality multipliers and caps positive gains per role/30-day epoch. Maintenance
now has only the three-member shard commit/reveal queue path; the unused
single-validator `MAINTENANCE_VALIDATION` contract was removed. The legacy Demo
HTTP route and Demo SDK method that could directly submit one
validator result are now removed as well; OpenAPI 0.8.15 uses `testerIds`,
`reportHashes` and `aggregateEvidenceHash` as the panel projection while marking
the first-member aliases deprecated. Canonical task quality gains now reject
sub-10-AGT, same-address and repeated publisher-Agent-role relationship farming,
require three distinct credited publisher relationships for priority status,
and never suppress failures. Dashboard 2.5/OpenAPI 0.8.15 publish this boundary.
Wallet-level common-control still requires external Sybil attestation and
deployment verification remains external. The current-source full
contract run now passes all 35 cases across seven files in one uninterrupted run,
including the task-context relationship gate, exact quality-event selector and
the four-case Court penalty/rehabilitation suite. The `1764c30` fixed 22-command
release QA and immutable candidate bind this regression evidence to that frozen source;
only reports for earlier source revisions are historical.

Quality-weighted evaluator and validator selection now binds a request-time
registry version/timestamp checkpoint into the future-block proof. Subsequent
positive scores, reactivation and added capabilities cannot improve an old
draw; current withdrawal, deactivation, capability removal, cooldown and bans
remain safety vetoes. The focused five-case quality suite and both real panel
selection paths pass, all 21 deployables remain below EIP-170, and AI
Dashboard 2.5/OpenAPI 0.8.15 expose the closed anti-manipulation and public
rehabilitation policies. The Agent-initiated Court path freezes at least 500 AGT,
requires an exact matching 2-of-3 resolution, restores only the 2500-bps floor,
slashes rejected appeals by 5/15/30%, and expires no-quorum cases after three
days without restoration or penalty; its focused four-case Court suite passes.
Common-control resistance remains an external attestation gate; the frozen-
source packaged evidence is closed by candidate `nShHeijb9O7TsJrsHaT6w`.
The GitHub branch handoff is synchronized through Pull Request #1; merging the
current reviewed branch head into `origin/main` remains an accountable
repository-owner decision.

Maintenance checkpoints now clear the acceptance assignment and enter the same
current-registry, future-block, quality-weighted three-validator selection used
for initial acceptance. Coordinator retries are chain-state idempotent, and a
redraw is allowed only after the recorded 256-block blockhash window expires;
an RPC or write failure can no longer silently replace validators. OpenAPI 0.8.15
publishes the matching idempotent coordinator completion results. This is
current-source regression scope and does not revive the historical fixed QA.

The prior frozen application suite passed 348/348 tests across 92 files; typecheck,
lint, all 15 Worker/Ops bundles and the production Web build pass. The Demo and
homepage participant split now matches RewardVault's post-network Agent pool:
80% executors, 20% three-validator panel and only rounding dust to reserve. This
does not replace ProtocolEconomics' outer 95/3/2 Agent/DAO/source routing.

The production Pilot gate now derives the anti-cheating proof from canonical
events instead of accepting three generic Agent addresses. It requires a
complete epoch-bound three-shard panel for every adopted task, three funded and
role-isolated arbitrators, exact-hash quorum, exact upheld accounting, the
5/15/30 false-challenge sequence, and uphold/reject/expiry rehabilitation
coverage. Panel and Court events expose the epoch, frozen stake, locked target
amount, applied penalty tier and resulting false-challenge count needed for an
independent replay. The `1764c30` nine-contract runtime manifest matches that
milestone's bytecode and ABI; its uninterrupted contract run passed 31/31 cases
across six files, including decoded event assertions and the
bounded selection-pool exhaustion/no-resampling regression. The
application suite includes nine fail-closed Pilot qualification cases. The
`1764c30` fixed release QA remains authoritative only for that frozen milestone;
it is historical for the current paid-capacity source.

Dashboard schema 2.5/OpenAPI 0.8.15 now separate the complete 37-operation HTTP
contract from the compiled chain surface. All 101 mutable signatures across the
nine deployment artifacts are partitioned into 46 supported participant actions
and 55 explicit governance-only, protocol-internal or generic-token exclusions.
Each action publishes its exact function signature, role, authorization
precondition, effect and compatibility status; each exclusion publishes its
classification and reason. Human rendering uses a separate chain lifecycle
section, while the compiled-artifact inventory regression fails on omissions,
duplicates, overlap or undocumented new mutations.
The prior frozen-source application regression passed 348/348 tests across 92 files,
TypeScript, ESLint, all 15 Worker bundles and the optimized Next.js production
build. The fixed 22-command release QA reran after that source freeze and binds
those results to historical candidate `nShHeijb9O7TsJrsHaT6w`.

Objective task advancement no longer depends on the configured coordinator
wallet. Inactive-executor eviction, validator-draw request/finalization and due
maintenance-panel request are permissionless while retaining all existing state,
deadline, frozen-snapshot, conflict and future-block checks. The coordinator
worker remains an optional idempotent automation operator and has no authority
to submit or prune candidates. Dashboard schema 2.5/OpenAPI 0.8.15 publish the
exact permissionless action set and `callerSelectionAuthority: NONE`; contract
regression executes each changed path from a non-coordinator wallet. The fixed
release QA ran after this governed Solidity change and binds the final result.

The local selection scalability gate is now closed at its governed boundary.
`AgentRegistry` contains
a protocol-created selection pool that freezes the complete request-time
candidate prefix; anyone may
append only the next sequential page of at most 64 candidates, and the future
block is scheduled only when the full prefix is complete. A Fenwick tree draws
in logarithmic time, preserves immutable candidate/frozen-weight audit rows and
persists at most 16 live-safety/conflict prunes per transaction. Focused tests
prove partial construction has no entropy, oversized pages fail, conflicted and
later-disabled candidates cannot win, three winners are unique, and frozen
weights remain unchanged. Evaluator and validator TaskRegistry paths now use the
pool through deployment wiring, AgentRegistry events, PostgreSQL outbox jobs and
bounded Coordinator retries. A pool exhausted below three live conflict-free
winners records the exhaustion registry
version and may create exactly one deterministic successor only after a later
version. The successor derives its entropy from the already observed predecessor
instead of obtaining another future block; evaluator and validator TaskRegistry
paths follow the successor through the same event/Worker lifecycle. A test-only
sparse-prefix harness now executes the exact production last 64-candidate page
and 16-prune Fenwick path at the governed 65,536-Agent boundary; both remain
below the shared 30,000,000-gas transaction budget. Dashboard 2.5/OpenAPI 0.8.15
publish the passing local boundary. The `1764c30` fixed release QA includes this
boundary; the new paid-capacity development cycle is not frozen.

Advertising and sponsorship accounting now has a deterministic, settlement-
asset-scoped local reconciliation state machine. It separates unconfirmed
revenue, confirmed platform cash, available allocation, submitted-unconfirmed
buybacks and confirmed AGT receipts; enforces the 50/40/10 and 70/10/10/10
routes; and rejects duplicate receipts/transactions, allocation overspend,
future timestamps, excessive TWAP deviation and per-period cap overflow. It is
explicitly simulation-only and does not activate or pretend to execute a DEX
route, oracle, buyback or burn.

Dashboard schema 2.5 and OpenAPI 0.8.15 now expose the exact advertising and
sponsorship allocation basis points, supported settlement assets, five ledger
states and required replay/TWAP/slippage/period/minimum-output controls. Both the
JSON API and bilingual human panel say realized revenue is unavailable and live
receipts are not indexed. The machine policy explicitly sets promotion influence
over evaluator/validator/arbitrator selection, quality ranking, completion rules
and challenge timing to `NONE`.

The current full 31-case contract run now also proves the economics router
through the real TaskRegistry lifecycle rather than only through an isolated
router fixture. A valid source is frozen before publication and remains
unchanged after source reconfiguration or another publisher commitment; the
200-AGT gross grant routes exactly 190/6/4 to Agents/DAO/source. Decoded events
prove the frozen 1000-AGT stake basis is charged exactly 2/3/7/3 AGT at
evaluation/publication/acceptance/maintenance and each amount splits
35/20/20/15/10. A second self-referring source falls back to DAO and, while the
task remains in evaluation, has consumed only the 0.2% evaluation stage. This
is included in the historical `1764c30` frozen-source QA and candidate binding.

The superseded application source froze after adding visible failure, busy state and duplicate-
safe boundaries to language, clipboard and Demo mutations. Discovery
schema 1.1 and OpenAPI 0.6.9 exposed explicit single-task,
job-heartbeat and job-completion templates. That 307-test / 83-file suite
enumerates the production SDK prototype, binds every workflow to discovery and
verifies every discovered API template exists in OpenAPI. It also binds the
six-entry mobile primary-navigation contract so the AI Dashboard remains
directly reachable when the desktop sidebar is hidden. Structured action results
now drive success/error styling and accessible live-region semantics without
inspecting translated text; one-time API keys stay outside automatic
announcements. Typecheck, lint, Worker build, production Web build and packaged
production delivery smoke pass. Notification updates now expose disabled
`aria-busy` state and accessible structural success/failure feedback.
Locale writes no longer refresh after rejection, clipboard failures are
announced, and Demo stake/faucet writes share one in-flight guard.

- Historical application QA: all 22 commands passed uninterrupted from
  `2026-09-01T07:16:46.244Z` through `2026-09-01T07:28:58.095Z`.
- Source SHA-256:
  `sha256:e2c88e37870b5bcf909b299d90239151cbb3f627005e330a82cecad8e7d30cac`.
- Candidate build ID: `unFAJP0q6TybW71fBjdHx`.
- Candidate payload SHA-256:
  `sha256:e88563e5c91c01f6e5a1f52f695832f577a9dec80d7c449448f8023f8b82ff21`.
- Candidate payload size: 2,580 entries / 69,565,250 bytes.
- Release manifest SHA-256:
  `sha256:651c3b7a5329b643b888e3357e223615d6608fe7bd692e34333892e591172679`.
- QA report file SHA-256:
  `c8daad4612fa58a86b08fd4ca8e6f14fcfaef174ab3438081ce883735ad1e816`.

The external QA report is mode 0600; the candidate root is mode 0555 and its
manifest is mode 0444. All 22 exit codes, 316 governed-source entries, payload
digest/count/bytes, server and manifest hashes, 2,478 files, 775 directories,
102 safe relative links and read-only permissions were independently checked.
This closed the local QA/candidate gate for that superseded source only. It does
not close any current-source gate. The candidate remains unactivated; public
launch remains in the external collaboration queue.

## Superseded notification-feedback baseline

Before the language, clipboard and Demo mutation controls, the notification-
feedback source passed all 22 commands from `2026-09-01T06:55:09.479Z` through
`2026-09-01T07:07:23.098Z`. It bound 304 tests / 82 files, source
`sha256:bc11ad3f48840203c376208aaba0dd36cd93757ddcb285a1433b4645eb1dd5bb`,
candidate `OSan3Mq5MLYKXJTeG2o7m`, payload
`sha256:3b8800b1f5edc368b37ba178fdfe292c70af1be5149b711d39333454085ef2cb`
(2,580 entries / 69,561,072 bytes), manifest
`sha256:e5573501e7d1c77c59d28659d8952bb2a2281f66b505317e63ab10ac78a32c77`
and report file SHA-256
`922fb76c5deef816c97c1f6118936b243ea647be7820bdf2c3c0ec891f5aebd3`.
It is historical evidence for that exact source only.

## Superseded structured-action baseline

Before notification-mutation feedback, the structured-action source passed all
22 commands from `2026-09-01T06:32:57.912Z` through
`2026-09-01T06:45:11.068Z`. It bound 302 tests / 81 files, source
`sha256:216be2e21faddd97fda704023a6d03495133453bdb5aa0ef907b21ee76598783`,
candidate `LHh-yO9dCy5gHjUmXY8ce`, payload
`sha256:31b20193441de40c16cc52c1de31fe3fa56465d7fd654aabfaca11a49cc6713e`
(2,580 entries / 69,558,287 bytes), manifest
`sha256:a4fef8ea477e4b0e25da4db6aeae21db4572f1d60e6e9c85c4cbfea3d46044e2`
and report file SHA-256
`9f80863cfb302c9952ca0d79c7bd9e8588d9d79b20255863cca4c1927c70cc7a`.
It is historical evidence for that exact source only.

## Superseded mobile-navigation baseline

Before structured action-result semantics, the mobile-navigation source passed
all 22 commands from `2026-09-01T06:10:44.878Z` through
`2026-09-01T06:22:57.835Z`. It bound 300 tests / 80 files, source
`sha256:91414a22322f66413973dd555e97fa0a369e6193527fca13149db9f03d8b8ee0`,
candidate `MD8bi8aPLoBJkAPvMNNH_`, payload
`sha256:e16bb5ab466fd626df5a58da87a496dc5466966de1eb541f892cae06efb8f94e`
(2,580 entries / 69,557,698 bytes), manifest
`sha256:90128b2a6965c24109ac3ee7ce5f1173c28a2395be456e94581a3564083ad043`
and report file SHA-256
`f69c987bb711b6e3d3b7fecc73e773ca68c016d07155021bbe5e2abbb7642c97`.
It is historical evidence for that exact source only.

## Superseded discovery baseline

Before the mobile Dashboard navigation correction, the frozen discovery source
passed all 22 commands from `2026-09-01T05:43:49.236Z` through
`2026-09-01T05:56:01.404Z`. It bound 299 tests / 79 files, source
`sha256:70a72cdf57f42a9c4b73591910f8bceb7166e8afb2945668eb2ee4fb3720e204`,
candidate `ujIAIVqnhAuxAaZ1bhOgs`, payload
`sha256:9da2b778f26f07c2160b095e7de7de80b1111bc86010482b2b90d2cf21549c1a`
(2,580 entries / 69,557,677 bytes), manifest
`sha256:4ef4d5f7122d45bd3f62dbbba0a77e1503f066cd87e94d7ab3e109ecde87e6c5`
and report file SHA-256
`5b033050e6c4d63ec7781f6f2cc1751dcd963c0f07ecffeb5bcffea893ea980d`.
It is historical evidence for that exact source only.

## Superseded completion-result baseline

The governed source was frozen at OpenAPI 0.6.8 after strict Agent job-completion
results and QA secret-isolation hardening. The evidence below is now historical.

- Unit suite: 298 tests across 79 files.
- Fixed application QA: all 22 commands passed from
  `2026-09-01T05:20:35.166Z` through `2026-09-01T05:32:45.483Z`.
- Source SHA-256:
  `sha256:e9feab3bbef8f503759fb9d408226ce89afed46e03985be3a4dea4aec4a9d9e4`.
- Candidate build ID: `XyZXS9ytOPnLY3rk1mG-k`.
- Candidate payload SHA-256:
  `sha256:ee4817c8f07c4fd7ac869a9536211cfdccacca38460629458b38c1065627e1f3`.
- Candidate payload size: 2,580 entries / 69,557,461 bytes.
- Release manifest SHA-256:
  `sha256:fc2a2a472145f2af86aa7370efd20c34d2c2f8b8b37196d234c25e547c808fb0`.
- QA report file SHA-256:
  `1497cbb8a3226bcb6f483f4f743621f35d496a0396caffd5ae911022b81736e7`.

The report is mode 0600, the candidate root is mode 0555 and its manifest is
mode 0444. All command exit codes, source hash, candidate payload hash/count/
bytes, server hash, manifest hash and permissions were independently recomputed
after that run. It is historical evidence for its exact source only and no
longer closes the current-source QA gate.

## Superseded historical baseline

At that point governed source work resumed to close the Agent job-completion
result contract, so the baseline below became historical evidence for its exact
source only and stopped closing the local-delivery gate.

- Unit suite: 296 tests across 79 files.
- Fixed application QA: 22 commands passed from
  `2026-09-01T04:32:18.215Z` through `2026-09-01T04:44:28.608Z`.
- Source SHA-256:
  `sha256:df09adbb03c51a360c3f17600a7bc697b58768a84714f7d76a0eed86f364c60c`.
- Candidate build ID: `pzyi7O5lBqKQfT5suo3MY`.
- Candidate payload SHA-256:
  `sha256:d0a83e75bd081f5d6930e4cf79ae314ea29d86d22afe620dcbc1f4b1055ab65c`.
- Candidate payload size: 2,580 entries / 69,541,915 bytes.
- Release manifest SHA-256:
  `sha256:58453e72ac27004c340b957eceeb6f29f83265bc059fda544e080396bef54199`.
- QA report file SHA-256:
  `acd8fc9955f1e1c8f14fd992b48e50de21d859afc21f50f977d1fd6c9ba861bb`.

The report, source tree, candidate payload, permissions and release manifest were
independently reverified after the run. OpenAPI 0.6.7 and packaged-production
smoke bind the wallet-session requirements for registration and task-
definition review while preserving logged-out session inspection and stale-
cookie logout recovery. The production SDK now exposes only methods bound to
OpenAPI operations; seeded-state task mutations are isolated in a loopback-only
Demo client that refuses production mode, and the packaged integration example
uses runtime chain configuration plus BSC transactions.
Wallet challenge and verification both have trusted-client application limits;
expired nonce hashes and inactive client windows have indexed 24-hour retention,
with real PostgreSQL deletion and packaged HTTP 429 evidence in the fixed QA.
Wallet-auth request constraints now execute as shared strict closed schemas;
the packaged runtime binds malformed input to 400, invalid credentials to 401,
origin failure to 403 and the rate-limit boundary to 429.

That historical candidate upgrades evaluator and tester signing to
domain-separated V2 messages and makes signed-report retries return only the
canonical stored record. OpenAPI 0.6.1 exposes every signing-domain field, and
the production smoke now checks canonical exact retry plus equivocation
rejection against real PostgreSQL. These controls are bound by that historical
fixed QA and immutable candidate.

That historical candidate additionally persists the exact verified V2
signing version and full message for evaluator/tester records. This keeps the
signature preimage independently recoverable after task state changes and makes
preimage drift an equivocation error. The real PostgreSQL migration/retry smoke
passes and is included in the historical fixed QA and immutable candidate.

That historical candidate makes the production projection independently
revalidate each stored report hash, strict V2 message, configured TaskRegistry
and recovered signer before using report fields. Missing-domain legacy rows are
offline-audit-only by default. Focused tests and a real PostgreSQL corruption
smoke pass and are included in the historical fixed QA and immutable candidate.

That historical candidate additionally requires each tester message's work
round, execution mode and executor-order hash to match the current chain
projection. Focused tests reject each mismatch and the real PostgreSQL smoke
rejects a stale work round; both are included in the historical fixed QA and
immutable candidate.

Agent registration, delivery, signed evidence and task-commitment bodies now
execute strict runtime schemas. The historical candidate closed all 18 then-
advertised JSON writes and fully described them in OpenAPI. All 29 repository
JSON decoders execute a real runtime Schema before business logic; the current
source closes the newly advertised nineteenth JSON write as well.

All 17 production SDK HTTP operations now advertise closed successful response
envelopes, and the SDK validates those plus discovery through 18 strict bounded
runtime schemas. Missing, mistyped or unknown top-level fields fail with
`PROTOCOL_RESPONSE_SCHEMA_INVALID`; packaged production smoke parses the public
Agent directory, AI dashboard, discovery and runtime chain configuration with
the same schemas and checks every documented 2xx envelope.

The historical candidate upgraded the AI dashboard to schema 1.1 and
OpenAPI 0.5.9. Its machine action contract enumerated all 33 then-documented
operations exactly once with operation ID, method, path, workflow phase, role,
authentication precondition and effect. Focused contract and SDK checks plus the
packaged production smoke are included in that historical fixed QA and immutable
candidate.

The historical candidate inventories all 55 actual API route operations,
requires 37 production protocol operations in AI dashboard schema 1.2 and
OpenAPI 0.6.0, and explicitly accounts for 18 Admin, operational, browser-only
or Demo-only exclusions. It adds the omitted business-adoption and wallet-
notification workflows plus strict bounded response parsing. Focused route and
response tests plus the packaged production smoke are included in its historical
fixed QA and immutable candidate. The historical OpenAPI 0.6.5 QA superseded
that earlier evidence, and the historical OpenAPI 0.6.6 QA superseded both.

That historical governed source publishes OpenAPI 0.6.7 and now requires all 37 production operations and all 38
JSON 2xx responses to resolve to closed OpenAPI envelopes. The ten formerly
status-only task-definition, commitment, credential and hidden-test successes
execute strict server response schemas, normalize database timestamps where
needed, and use private/no-store headers. Focused contract, type and lint checks
pass in the historical unchanged-source fixed QA.

That historical governed source publishes OpenAPI 0.6.7 and binds all 185 advertised
4xx/5xx responses across 37 production operations to one closed bounded error
envelope, including an explicit safe 500 for every operation. Runtime validation
errors use `VALIDATION_ERROR` with sanitized issues; unclassified exceptions use
`INTERNAL_ERROR`; the SDK rejects malformed error bodies. Focused contract,
type and lint checks pass in the historical unchanged-source fixed QA.

That historical governed source publishes OpenAPI 0.6.7. Completed-task pagination now
rejects unknown or duplicate query parameters and stale cursors instead of
silently restarting page one; cursor/category bounds match runtime. Hidden-test
ciphertext upload uses the authenticated wallet session as its sole publisher
identity, with the redundant `x-publisher` header removed from every surface.
Focused runtime and contract checks passed in the historical unchanged-source
fixed QA and immutable candidate.

That historical governed source additionally parses Agent authentication headers before
database lookup and `scrypt`. Exactly one bounded ASCII Agent ID and one bounded
`amp_` credential are accepted; missing, malformed, oversized and duplicate-
merged values use the same authentication failure. OpenAPI 0.6.7 publishes the
exact constraints and packaged smoke verifies them. Focused checks, the
historical fixed QA and independent candidate verification passed.

That historical governed source executes shared strict Schemas for all 18 production
dynamic-path operations before database, Redis or chain work. OpenAPI 0.6.7
publishes exact UUID, positive on-chain task ID, Agent ID and queue-job ID
bounds, and every malformed path has a documented 400 envelope. Hidden-test
ciphertext PUT additionally declares its reachable 401/403/409/415 failures.
Focused runtime and source/OpenAPI contract checks, the historical fixed QA and
independent candidate verification pass.

That historical governed source routes hidden-test ciphertext through one authenticated,
manifest-bound binary reader. It separates empty body and malformed declared
length (400), exact manifest-length mismatch (409), bounded overflow (413), and
unsupported media type/encoding (415). OpenAPI 0.6.7 and focused unit tests
enforced the same machine-readable codes in the historical packaged smoke,
fixed QA and immutable candidate binding.

That historical governed source publishes OpenAPI 0.6.7 and replaces the arbitrary
Agent job kind/payload surface with a shared closed eleven-kind runtime union.
Each kind maps to one role and exact bounded payload across PostgreSQL outbox,
Redis recovery/lease, server response parsing and the SDK. Complete chain
provenance is retained, DB timestamps are normalized, and corrupt, oversized,
ID-mismatched or role-mismatched stored jobs are quarantined. Focused unit,
queue, real PostgreSQL/Redis reorg and packaged production-Web checks pass in
the historical fixed QA, which binds the immutable candidate above.

## Current completion-result hardening

The source now publishes OpenAPI 0.6.9 and maps every one of the eleven Agent
job kinds to an exact closed completion result. The server validates the result
against the actual leased kind before releasing the lease; invalid results keep
the lease available for correction. Exact same-Agent/result retries succeed
idempotently, while owner or result conflicts fail closed. Worker completion
records no longer copy Artifact storage URLs or accept arbitrary extensions.

Focused evidence passes: 299 unit tests across 79 files, typecheck, lint, Worker
build, real Redis queue smoke, real PostgreSQL/Redis reorg smoke and packaged
production-Web delivery smoke. That frozen source subsequently passed the fixed
22-command QA and is bound to the historical `1764c30` candidate above.

The first fixed-QA attempt exposed caller-environment contamination: the QA
isolation list had drifted from the canonical runtime-secret inventory and did
not remove the trusted-proxy secret. The runner now derives all direct and
`_FILE` names from that inventory, with a regression test. Two early attempts
stopped at command one; a later attempt correctly reached command sixteen and
rejected an unnecessary direct proxy secret supplied by the QA invocation. None
produced a report or candidate. The successful `1764c30` run superseded all of them.
Dashboard schema 2.5/OpenAPI 0.8.15 additionally expose receipt-bound signed
task placements. Production imports use `promotion:import`, a unique settlement
receipt hash, an overlap-locked PostgreSQL window and a configured
`PROMOTION_ATTESTATION_SIGNER`; invalid or expired rows are omitted. Human and
AI surfaces label placements `SPONSORED`, and executable tests prove ranking is
display-only and leaves protocol task objects and validator/quality fields
unchanged. Live payment receipt collection remains an external activation item.
