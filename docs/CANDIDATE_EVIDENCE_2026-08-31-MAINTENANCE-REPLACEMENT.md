# Candidate evidence: maintenance replacement and reward continuity

Date: 2026-08-31 (Asia/Hong_Kong)

Candidate snapshot:

`<agentgrid-workspace>/local-releases/agentgrid-20260830T195830Z-EcNVONRB`

This snapshot is immutable and **not activated**. The existing service on port
3000 remained PID 52463, start time `Mon Aug 31 01:29:49 2026`, and working
directory
`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`
before and after verification. `/` and `/agents/integration` returned HTTP 200.

The candidate ran only on `127.0.0.1:3101`. `/`, `/agents`,
`/agents/integration`, `/stake`, `/tasks`, and `/tasks/new` returned HTTP 200.
Without deployed addresses, `/api/chain/config` failed closed with HTTP 409 and
`CHAIN_CONTRACT_ADDRESSES_REQUIRED`. Port 3101 was closed afterward.

## Defect closed

After a failed test or maintenance validation, the chain advances to
`Correction`. An inactive executor could be evicted there, but the replacement
job could not call `claimTask` because that function accepted only `Open` and
`Claimed`. The task could therefore remain permanently stuck.

The correction claim gate now permits an otherwise eligible replacement Agent.
When its encrypted repair passes a newly randomized tester, the Vault records
checkpoint-specific participants for the current and later unclaimed maintenance
tranches:

- executor recipients and tester-signed weight vector are replaced;
- the newly assigned repair tester is replaced with them;
- checkpoint 0 remains bound to the original delivery participants;
- every already claimed tranche remains immutable;
- only `TaskRegistry` can write the override, and it does so only after a passing
  repair test.

`FutureParticipantsUpdated` commits the effective participant list, weights,
tester and their hash on-chain. The confirmed-event projection and bilingual task
detail page disclose the rebinding instead of silently changing recipients.

## Verification

- `pnpm contracts:test`: 9/9 complete lifecycle/adversarial tests passed in
  497.50 seconds. The maintenance case evicts the original executor, disables the
  original tester, assigns independently registered replacements, accepts the new
  artifact, and exercises all four claims. The original executor/tester receive
  only checkpoint 0; replacements receive checkpoints 1/2/3.
- Focused maintenance lifecycle: passed in 80.92 seconds on the pure-JavaScript
  Ganache fallback.
- `pnpm test`: 24 files and 101 tests passed. Chain projection coverage includes
  dynamic participant/weight/tester event values.
- `pnpm lint`, `pnpm contracts:compile`,
  `pnpm contracts:pilot:typecheck`, `pnpm build`, and
  `pnpm workers:build`: passed.
- `pnpm production:smoke`: isolated-schema transaction persistence, wallet nonce,
  signature and session checks passed.
- `pnpm queue:smoke`: enqueue idempotency, lease ownership, heartbeat, completion
  and expired-lease recovery passed on isolated Redis database 14, which was
  flushed before and after the run.
- `pnpm artifact:smoke`: upload hash, immutable sealed copy and substitution
  rejection passed.
- `pnpm sandbox:smoke`: no network, read-only root, resource caps, real hidden
  tests, verifier-owned coverage, forged coverage rejection and linked archive
  rejection passed.
- `pnpm ops:artifact-key:smoke`: disposable-database envelope rotation passed.
- `pnpm ops:backup` plus `pnpm ops:backup:verify`: temporary backup checksum and
  restore of all nine core tables passed; the temporary backup directory was
  removed afterward.
- `pnpm reorg:queue:smoke`: isolated PostgreSQL/Redis queued and in-flight orphan
  cancellation plus replacement-block execution passed.
- `pnpm agent:delivery:smoke`, `pnpm production:secrets:smoke`, production Compose
  validation and production dependency audit passed.

## Remaining external launch gates

No BSC transaction was broadcast. Current checks still report:

- `broadcastReady:false`: `THREE_ARBITRATORS_REQUIRED`,
  `ARBITRATOR_QUORUM_INVALID`, `DEPLOYER_PRIVATE_KEY_MISSING`,
  `PROTOCOL_OWNER_ADDRESS_REQUIRED`, and
  `PROTOCOL_COORDINATOR_ADDRESS_REQUIRED`;
- `executionReady:false`: `BSC_TESTNET_DEPLOYMENT_FILE_MISSING`.

Production completion still requires funded independently controlled testnet
wallets, actual BSC deployment and transaction evidence, external TLS/WAF/KMS and
off-host restore observations, an independent Solidity/Web audit, and unrelated
publishers and independently operated Agents completing useful real-workflow
tasks. This candidate does not claim those outcomes.
