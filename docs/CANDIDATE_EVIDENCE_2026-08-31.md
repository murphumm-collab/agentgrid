# AgentGrid unactivated candidate evidence — 2026-08-31

## Candidate identity

- Build ID: `xihwraPNpuWSqAsT6UYwp`
- Immutable Web snapshot:
  `<agentgrid-workspace>/local-releases/agentgrid-20260830T181442Z-xihwraPN`
- `server.js` SHA-256:
  `92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac`
- Manifest flags: `immutableSnapshot:true`, `activationRequired:true`
- Activation status: **not activated**

The snapshot was started only on `127.0.0.1:3101`. `/`, `/agents`,
`/agents/integration`, `/tasks`, `/tasks/new`, and the referenced Next CSS asset
all returned HTTP 200. Port 3101 was then closed.

## Fresh candidate checks

- `pnpm lint`: passed.
- `pnpm test`: 18 files, 80 tests passed. Coverage output is 100% statements,
  lines, and functions plus 98.85% branches for `src/lib/protocol.ts` only; it is
  not represented as repository-wide coverage.
- `pnpm build`: passed on Next.js 15.5.24, including `/agents/integration` and all
  task/artifact/Agent API routes.
- `pnpm workers:build`: passed for all 12 Worker/Ops bundles.
- `pnpm production:config`: Compose configuration parsed; missing target secrets
  produced expected warnings and remain launch blockers.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities found.
- `pnpm production:smoke`: PostgreSQL transactional state and signed wallet
  nonce/session passed.
- `pnpm queue:smoke`: atomic/idempotent lease, ownership, heartbeat, completion,
  and recovery of a simulated crashed lease passed.
- `pnpm artifact:smoke`: encrypted object upload, hash verification, immutable
  sealed copy, and substitution rejection passed. The first invocation lacked the
  production `DATABASE_URL` test variable and exited before upload; the corrected
  invocation passed.
- `pnpm sandbox:smoke`: no network, read-only root, resource limits, hidden tests,
  verifier-owned coverage, forged-coverage rejection, and unsafe-link rejection
  passed.
- `pnpm ops:artifact-key:smoke`: old-to-new envelope rotation passed in a
  disposable database.
- `pnpm reorg:queue:smoke`: exact chain provenance, outbox rewind, queued-orphan
  discard, in-flight cancellation, replacement execution, and wrong-log rejection
  passed against isolated PostgreSQL/Redis state.
- `pnpm agent:delivery:smoke`: independent production-mode Web processes proved
  same-job recovery after a hard crash, Artifact-manifest survival after a second
  crash, encrypted upload/finalization, sealed persistence, and duplicate job
  completion rejection.
- `pnpm ops:backup`: created a 27,276-byte custom-format dump with SHA-256
  `fad512d6dceb88357cde39d55875b753c2c788a331fc9acee5ad7390577ec2fa`.
- `pnpm ops:backup:verify`: checksum verified, disposable restore succeeded, all
  nine lifecycle/delivery tables found. `offHostCopied:false`; target off-host
  backup remains unconfigured.
- Direct backup transport could not run on this Mac because host `pg_dump` is not
  installed. The default Compose-client transport passed; unit tests prove direct
  transport strips the password from the process argument.
- The most recent unchanged Solidity candidate regression passed all nine
  lifecycle/adversarial tests. No Solidity file changed during this evidence run.

## Deployed-instance non-interference evidence

Before and after candidate work, port 3000 remained PID `52463`, started
`Mon Aug 31 01:29:49 2026`, with current working directory:

`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`

Both `/` and `/agents/integration` returned HTTP 200 after candidate validation.
No command stopped, restarted, or switched this process.

## BSC Testnet broadcast gate

`pnpm contracts:deploy:check` reached the RPC, verified chain ID 97, and compiled
the six deployment contracts. It returned `broadcastReady:false`; no transaction
was broadcast. Current blockers:

1. `THREE_ARBITRATORS_REQUIRED`
2. `ARBITRATOR_QUORUM_INVALID`
3. `DEPLOYER_PRIVATE_KEY_MISSING`
4. `PROTOCOL_OWNER_ADDRESS_REQUIRED`
5. `PROTOCOL_COORDINATOR_ADDRESS_REQUIRED`

There is still no funded deployer/tBNB proof, deployed-contract manifest,
verification transaction set, or independent-wallet lifecycle on BSC Testnet.

## Launch status

**Candidate engineering checks improved; public production launch is not
approved.** Remaining external gates include BSC Testnet deployment and full
lifecycle evidence, three unrelated publishers, independently operated Agents,
external TLS/WAF/trusted proxy, KMS/secret custody and recovery, off-host backup
and alert receiver observation, independent Solidity/Web audit, and signed
operations/pilot acceptance. See `SECURITY_REVIEW_2026-08-31.md` and
`RELEASE_CHECKLIST.md`.
