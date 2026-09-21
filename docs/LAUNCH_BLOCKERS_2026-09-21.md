# Launch remediation, 2026-09-21

Base: `origin/main` `ed5ee3df6e4d7dd0da3fe1759c10b9fe4c9d8574`.
Scope: preserve protocol/product design; correct implementation bugs, reproduce unresolved protocol risks, and fail closed for public launch. Test results and logs accompany the delivery report; this document does not certify production readiness.

## Implementation fixes

| Area / function | Root cause | Change | Regression evidence |
|---|---|---|---|
| TaskRegistry.submitTest / submitCompetitionTest | Reports were accepted after the replacement deadline, if the timeout transaction had not executed | Reject at or after the 24-hour deadline | Collaboration and competition deadline transactions |
| TaskRegistry.review | Publisher could reject after automatic acceptance became due | Reject publisher reviews at or after the 3-day deadline; permissionless timeout acceptance remains available | Late reject rejected, timeout acceptance succeeds |
| TaskRegistry.submitContribution | First contribution could race eviction after six hours | First contribution must precede the eviction deadline | Exactly six hours fails; eviction succeeds |
| TaskRegistry.resolveRejection / respondToRejection | Publisher-win outcome left state Rejected with no terminal resolution flag; after withdrawal a later authorized resolver call could mint a grant without slashable stake (the deployed DisputeResolver also has its own resolved flag; this is defense at the TaskRegistry boundary, including resolver replacement) | Persist terminal resolution before external interactions; disallow subsequent responses and resolutions | Resolve publisher win, withdraw after seven days, reject another resolution, grant remains empty |
| RewardVault.createGrant / claim / fee registration and settlement | Epoch accounting did not reserve balances across epochs or separate evaluator escrow | Track outstanding reward and fee liabilities; prevent overcommit; decrease liabilities atomically on payouts | New epoch cannot reuse committed funds; evaluation settlement and delivery payout remain solvent |
| RewardVault.approveCheckpoint | Missing grant, repeated and out-of-order approvals were accepted by vault itself | Require existing grant, predecessor approval and single approval | Unknown grant rejected; 7/30/90 duplicate validation and claims rejected |
| RewardVault participant arrays | Direct registry calls could supply zero, duplicate or tester/executor overlap recipients | Validate participants at creation and repair rebinding | Zero, duplicate and tester-overlap recipients rejected; valid team/repair lifecycles preserved |
| StakeCreditManager.consumeCredit / executeWithdrawal | Relied on indirect lifecycle assumptions instead of explicit pending-withdrawal / active-lock guards | Validate live credit, minimum stake, task ID, withdrawal state and locks | Expired/pending credits rejected; assignment during pending withdrawal rejected |
| AgentRegistry.slashForTask / StakeCreditManager.slashPosition | Percentage of whole position could exceed one task's reserved collateral | Cap assignment penalty at task collateral and protect other tasks' reservations | Ten concurrent locks, reject eleventh, reject 101 AGT slash, preserve 900 AGT for other nine tasks |
| agent-queue.recoverExpiredLeases | Read/check/requeue/ZREM raced concurrent heartbeat or recovery | Atomic Redis script rechecks recovery score and lease, queues once, removes index atomically | Existing crash recovery and heartbeat smoke; parallel completed-job redrive |
| maintenance-scheduler / maintenanceJob | Hour-based IDs duplicated work and scheduled all overdue checkpoints | Stable identity per chain/registry/task/grant/repair round/tester/artifact/checkpoint; read confirmed chain state; schedule earliest unfinished checkpoint | Restart/hour identity, 7/30/90 ordering, exact due time, repair round, approval rollback |
| enqueueAgentJob / ci-tester-worker | Completed job retained in Redis could suppress work after reward transaction reorg | Canonical scheduler may atomically redrive completed jobs; active jobs remain untouched; worker discards stale assignment/round/artifact/checkpoint | 16 concurrent redrives yield exactly one new job; chain reorg smoke |
| protocol.validateSoftwareEvidence | NaN bypassed percentage comparisons | Reject non-finite coverage | NaN fails evidence validation |
| productionReleaseReadinessReport | External evidence alone could make launch appear ready despite known protocol risks | Unconditional revision-specific protocol blockers, not an environment-variable waiver | Readiness remains false even with pilot marked ready |
| CI | No workflow in current main | Core PR/main checks, contracts, typecheck, lint, build and isolated operational smoke | Local command evidence. GitHub rejected workflow upload because current OAuth credential lacks workflow scope; CI file is delivered separately and is not installed on GitHub |

## Remaining P0: no public launch

1. **Coalition/Sybil profitability and wallet rotation.** The chain permits independent-looking wallets with the same controller. A 1,000 AGT publishing stake, 1,000 AGT requested reward, 20 AGT publication fee, and 3 AGT evaluation fee produce a 200 AGT grant. Executor and tester receive 80% = 160 AGT; coalition evaluators recover 3 AGT. Net protocol-token profit is **140 AGT per completed fresh combination**, before gas and capital costs. Delivery alone returns 64 AGT against a 20 AGT irreversible publication fee. Stake/collateral are returned, so they must not be counted as burned costs. Changing publisher or other role wallets resets the key. Epoch limits bound losses but do not eliminate profit. Same-content task rejection would not prevent semantically equivalent submissions under new hashes.
2. **Unverified on-chain PASS.** Hash commitments and wallet signatures prove authorship, not successful independent execution or task value. An assigned tester may submit arbitrary nonzero hashes directly to the contract, bypassing the API's criterion checks. Three colluding evaluators and a colluding publisher can approve them. API checks alone cannot close this path.
3. **Biasable assignment.** Future block hash plus registry-index scan is not uniform sampling over a frozen eligible set. Eligibility/capabilities may change; the coordinator may choose when to finalize or restart an expired selection; block producers can bias entropy. Mainnet needs reviewed unbiased entropy and a committed eligible candidate set; independence still needs a separate mechanism.

Eliminating positive coalition ROI in a subsidized protocol with unverifiable identities/work requires an enforceable independence/value proof or a reviewed economic constraint on extractable subsidy. This patch deliberately does not silently replace the reward model or claim that address separation solves Sybil resistance.

## Remaining P1

- A maintenance tester disappearing while task state is Maintenance has no replacement path equivalent to Testing timeout. Likewise, an executor can submit an arbitrary hash before six hours and avoid the current no-contribution eviction rule; work quality cannot be inferred from that hash. A stalled team lead can fail to assemble final work. These require a precommitted progress/repair policy and contract space for recovery transitions.
- Epoch budget is consumed at grant acceptance, not publication; excess accepted work may wait for the next epoch or funding. New vault accounting prevents insolvency but does not guarantee acceptance liveness. Frozen repair tranches continue to reserve funds until repaired; no cancellation policy is invented here.
- Real independent BSC testnet pilot, 7/30/90 lifecycle evidence, external Solidity/application audit, external KMS and real off-host recovery/alert acknowledgement remain required.
- Queue redrive is at-least-once execution, not exactly-once off-chain sandbox work. Canonical contract checks and claim flags protect payouts; a deep reorg during validation can still waste computation/gas.
- TaskRegistry is 24,523 bytes, only 53 bytes below EIP-170. Every subsequent change must retain the bytecode size gate.

## P2

- Extend vault invalid-array and token-behavior fuzzing, and quantify economic sensitivity to gas, capital cost, token price and liquidity.
- Load-test real RPC/indexer/database failures at production scale. The 100/1,000/10,000 economic script is an analytical model, not that many chain transactions.
- Pin CI dependencies/actions and service image digests under the project's dependency update policy; apply required branch checks after hosted workflow results are available.

## BSC Testnet checklist

- [ ] Keep public release blocked until P0 protocol issues above are resolved and reviewed.
- [ ] Dedicated funded testnet deployer (preflight minimum 0.1 tBNB); supply key using supported secret-file mechanism. No private keys in Git or report.
- [ ] Separate Owner and Coordinator; at least three distinct arbitrators and valid quorum, separate from Owner/Coordinator; verify real controllers, not merely wallet strings.
- [ ] Confirm chain ID 97 and trustworthy RPC; verify token/reserve funding, ownership transfer, all six deployed addresses and registry wiring.
- [ ] Run `contracts:deploy:check`, then authorized testnet deployment, five-confirmation receipts, source/runtime bytecode verification and deployment manifest integrity.
- [ ] Rebuild runtime manifest, workers and application from the same candidate commit. These are non-upgradeable deployed contracts; source fixes do not patch any old deployment automatically.
- [ ] Run separated-role pilot: evaluation (three reports), collaboration and competition, encrypted artifact access, rejection/appeal, replacement/timeout, reward claims, repair and all maintenance checkpoints.
- [ ] Test indexer reorg and queue recovery against deployment events; retain signed evidence and retry behavior.
- [ ] Production domain/TLS/proxy boundaries, external KMS custody proof, off-host encrypted backup and actual restore, external alert/recovery acknowledgement, independent audit and accountable launch signoffs.

Local Ganache tests deploy and execute protocol bytecode. Delivery smoke uses a mocked chain RPC and real local PostgreSQL/Redis/S3; neither is evidence of a real BSC pilot. KMS/alert smokes use local fixtures and cannot certify an external provider.

## Recorded validation

- Main baseline: 190 application tests and 13 contract tests passed.
- Before-fix adversarial regression: 4 failed / 18 total (late tester, late publisher, late executor, cross-epoch insolvency); these are reproduced acceptance-of-invalid-operation failures.
- Final application suite: 52 files, 197 tests passed. Expanded contract suite: 21 passed.
- Full final-source application release QA: **22/22 commands passed**, exit 0, including compile, contracts, typecheck, lint, workers, build, real local PostgreSQL/Redis/S3 smokes, sandbox, reorg, delivery, secrets, local KMS/monitoring fixtures, backup/restore and immutable candidate snapshot.
- QA source digest: `sha256:13eef8929300098e55421b892c4665aea56525446dc0198a962965f5bc8ba261`. Candidate build: `dhR-eOixt8erppGPAn1iG`.
- Additional pilot typecheck and 16-way concurrent lease recovery/redrive checks passed.
- BSC deployment preflight connected to chain 97 but blocked on missing deployer, owner/coordinator and arbitrator configuration. Real pilot, external KMS, public edge and off-host evidence preflights remain blocked.
- Economic detector intentionally exits 2: coalition token profit persists. A green vulnerability reproduction is not economic-security acceptance. Public release remains blocked and the PR remains draft.
- GitHub OAuth rejected workflow upload because `workflow` scope is absent. Source fixes are pushed; CI is a separate deliverable, not an installed/verified hosted check.

Raw logs, machine-readable summary and the unsigned, hash-bound application QA report accompany the task deliverables. Coverage configuration still measures only `protocol.ts`.
