# AgentGrid candidate evidence — publisher-signed business adoption

Date: 2026-08-31 (Asia/Hong_Kong)

Candidate: `<agentgrid-workspace>/local-releases/agentgrid-20260830T202858Z-2MpXclMD`

Build ID: `2MpXclMDwgPBAQsYHNteB`

Server SHA-256: `92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac`

This is an immutable, activation-required candidate. It was not activated on
port 3000.

## Business-adoption control

- The authenticated publisher must first receive an audited release of the
  exact artifact currently committed by `TaskRegistry`.
- The browser hashes the deployment URL, ticket, PR, customer-delivery ID or
  audit-log reference locally. The raw reference is never submitted.
- The EIP-191 signature binds version, BSC chain ID, task, publisher, release
  UUID, plaintext artifact SHA-256, release time, workflow type, evidence
  SHA-256 and adoption time.
- The server verifies publisher session, same-origin request, rate limit,
  strict bounded schema, accepted canonical task state, exact release and chain
  artifact, time ordering and recovered signer.
- PostgreSQL stores append-only history and rejects a second attestation for the
  same task-and-artifact pair. A maintenance replacement may append a new
  artifact record; an obsolete artifact record is never surfaced as current.
- This proves integrity and attribution of the publisher's claim. It is not an
  independent proof that the claimed external business event is true.

## Fresh verification

- `pnpm test`: 25 files, 106/106 tests passed. The new policy tests cover wrong
  signer, task/artifact substitution, missing release, pre-acceptance state,
  early/future time, and maintenance artifact replacement. The displayed 100%
  coverage applies only to the configured `src/lib/protocol.ts` scope and is not
  used as broad feature proof.
- `pnpm contracts:test`: 9/9 full Solidity lifecycle/adversarial tests passed in
  498.57 seconds.
- `pnpm contracts:compile`: 8 deployable contracts compiled.
- `pnpm contracts:pilot:typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed and included
  `/api/tasks/[id]/business-adoption` plus the updated task detail route.
- `pnpm workers:build`: all 12 worker bundles built.
- `pnpm production:config`: passed; the local shell emitted the expected warning
  that `EVALUATOR_AGENT_ID` is unset and production must provide it.
- `pnpm production:secrets:smoke`: 12 services, 11 external role-specific secret
  mounts, file-secret policy and bundled migration Worker passed.
- `pnpm audit --prod`: no known vulnerabilities found.

## Isolated durable-state and recovery proof

No deployed database was migrated. A disposable PostgreSQL database was used.

- The production smoke persisted two immutable adoption rows for one task and
  two final artifact hashes.
- A duplicate write for the same task-and-artifact was rejected with
  `BUSINESS_ADOPTION_ALREADY_RECORDED`.
- A maintenance replacement artifact appended a second history row rather than
  overwriting the first.
- A custom-format dump was checksum verified, restored into a disposable
  database and verified to contain all 10 delivery/lifecycle core tables,
  including `business_adoption_attestations`.
- The source database, restore database and temporary backup directory were
  removed after verification.

## Candidate browser proof

The candidate was started temporarily on `127.0.0.1:3101`.

- `/`, `/tasks`, `/tasks/task-demo-001`, `/agents/integration` and `/protocol`
  returned HTTP 200.
- `/api/tasks/task-demo-001/business-adoption` returned HTTP 401 without a
  publisher session.
- `/api/auth/session` returned `Cache-Control: no-store` and `Vary: Cookie`.
- The task and Agent integration pages rendered in a real Chromium session.
- The only console error was the expected demo-mode HTTP 409 from
  `/api/chain/config`; the API intentionally fails closed when no verified
  deployment addresses exist.
- Port 3101 was stopped after verification.

## Deployed-version invariant

Port 3000 remained PID `52463`, started `Mon Aug 31 01:29:49 2026`, with cwd:

`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`

Both `/` and `/agents/integration` returned HTTP 200 after candidate testing.

## Still-open production gates

This candidate is not production completion. The following remain external or
unproven:

- Fresh `contracts:deploy:check` reached BSC Testnet chain ID 97 and compiled
  contracts, but returned `broadcastReady:false` with
  `THREE_ARBITRATORS_REQUIRED`, `ARBITRATOR_QUORUM_INVALID`,
  `DEPLOYER_PRIVATE_KEY_MISSING`, `PROTOCOL_OWNER_ADDRESS_REQUIRED`, and
  `PROTOCOL_COORDINATOR_ADDRESS_REQUIRED`.
- Fresh `contracts:pilot:check` returned `executionReady:false` with
  `BSC_TESTNET_DEPLOYMENT_FILE_MISSING`.

- funded BSC Testnet deployer and distinct owner/coordinator/three-arbitrator
  wallets;
- deployer private key, tBNB, broadcast deployment manifest and exact on-chain
  verification;
- seven independently controlled funded pilot wallets and a complete synthetic
  lifecycle broadcast;
- a real publisher who downloads the exact delivery, uses it in a real workflow
  and signs this adoption record while retaining the evidence preimage;
- external TLS/WAF/KMS/off-host backup and acknowledged alert delivery;
- independent Solidity/security audit and independent real-user/Agent pilots.
