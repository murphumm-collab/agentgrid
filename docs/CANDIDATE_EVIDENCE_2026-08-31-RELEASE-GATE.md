# AgentGrid unactivated candidate evidence — production release gate

Recorded 2026-08-31 (Asia/Hong_Kong). This document describes source and an
unactivated local candidate. It is not BSC deployment or public-launch approval.

## Deployment isolation invariant

- Existing listener: PID `52463`, start time `Mon Aug 31 01:29:49 2026`.
- Existing working directory:
  `<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`.
- Existing `/` and `/agents/integration`: HTTP 200 before and after this work.
- The existing process was not restarted, signalled, overwritten or activated.
- Candidate validation used only port 3101; that listener was stopped afterward.

## Candidate identity

- Build ID: `my08ennROh4UAZPLZAt-U`.
- Snapshot:
  `<agentgrid-workspace>/local-releases/agentgrid-20260830T212404Z-my08ennR`.
- Server SHA-256:
  `92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac`.
- Release-manifest SHA-256:
  `1e7e7d2deda334ff36fa4d049c6cf1f936ede956716fd280fa0ab340011144ac`.
- Manifest states `immutableSnapshot:true` and `activationRequired:true`.

## Reproducible local results

- `pnpm test`: 31 files, 126 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm lint`: passed.
- `pnpm workers:build`: 12 Worker bundles built.
- `pnpm production:config`: passed.
- `pnpm build`: passed; 21/21 static pages generated.
- `pnpm contracts:compile`: eight deployable contracts compiled.
- `pnpm audit --prod`: no known vulnerabilities.
- Solidity sources did not change in this release-gate slice; the immediately
  preceding full chain regression remains 9/9 passed.

## Isolated candidate HTTP results

- `/`, `/tasks`, `/tasks/new`, `/agents`, `/agents/integration`: HTTP 200.
- `/api/admin/release-readiness` without Admin bearer credential: HTTP 401.
- The same route with an ephemeral candidate-only credential: HTTP 200,
  `productionReleaseReady:false`, 20 explicit blockers.
- Response cache policy: `Cache-Control: no-store, max-age=0`.

## Deployment and release fail-closed results

- `pnpm contracts:deploy:check`: exit 2 and `broadcastReady:false` while required
  owner/coordinator/arbitrator/deployer inputs are missing.
- `pnpm contracts:deploy:bsc-testnet` without the exact acknowledgement: exit 1,
  `DEPLOYMENT_BROADCAST_ACK_REQUIRED`; no transaction was broadcast.
- `pnpm contracts:deploy:verify` without a manifest: exit 1,
  `BSC_TESTNET_DEPLOYMENT_FILE_MISSING`.
- `pnpm release:production:check`: exit 2,
  `productionReleaseReady:false`; it lists missing BSC deployment, real-business
  pilot, final evidence and operational/audit sign-offs.
- Production release signatures bind the exact candidate, 12 evidence-file
  hashes, three image digests, chain 97 and distinct owner/security/operations
  roles. The example draft successfully produced one shared manifest hash and
  three role-specific EIP-191 messages.

## Key implementation hashes

- `contracts/scripts/deploy.ts`:
  `05b07dd65e056e1cb768430a0e27ca3dc3977f0f6ad0c338f73410240628613b`.
- `contracts/scripts/verify-deployment.ts`:
  `fc267de70ef4599d254a1893b7a39f7dbc72a94ded6eb17bbc6bfe9ab76ad866`.
- `src/lib/production-release-evidence.ts`:
  `0d32b87bee1eea3ac04bdd5ed093d38a17cc2351d902f58fc3e70b8f4df05dea`.
- `src/lib/production-release-service.ts`:
  `5e26eb3538f14bf9a4463729f89f45a12ca76260f29d43a1b2f41c9c66d4228f`.

## External blockers that local development cannot close

- Funded BSC Testnet deployer and independent role wallets.
- Actual 17-transaction BSC deployment plus five-confirmation receipts.
- Three real adopted business tasks and the signed pilot task-set evidence.
- Target TLS/WAF/trusted-proxy and KMS custody/recovery drills.
- Off-host backup/restore and live alert-delivery evidence.
- Independent Solidity and Web/API audit reports with all high/critical findings
  closed.
- Three distinct final release signers, including the deployed protocol owner.

Until those preimages exist and `pnpm release:production:check` exits 0, this
candidate must remain unactivated and must not be described as production-ready.
