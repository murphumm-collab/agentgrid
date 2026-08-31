# Candidate evidence — real-pilot qualification gate

Checked at 2026-08-31 05:04 HKT. This document records an unactivated candidate;
it is not evidence of a BSC deployment, independent audit or real-user pilot.

## Candidate isolation

- Candidate: `<agentgrid-workspace>/local-releases/agentgrid-20260830T205434Z-BBAMdCNk`
- Build ID: `BBAMdCNk-3ZZDdXDFqfHa`
- Release manifest SHA-256:
  `de96ad9f0f5e5a38a548f24a0adc43e95d6522e555429e8e14a0d044eef61f23`
- `activationRequired:true`; this candidate was never bound to port 3000.
- Candidate was started only on `127.0.0.1:3101`, then stopped. `/`, `/agents`,
  `/agents/integration`, `/tasks`, `/tasks/new` and a referenced static CSS asset
  returned HTTP 200.
- `/api/admin/pilot-readiness` returned 401 without the Admin bearer credential,
  200 with it, `Cache-Control: no-store`, and a fail-closed report with
  `technicalEvidenceReady:false` and `launchEvidenceReady:false` in demo mode.
- The active port-3000 deployment remained PID 52463, start time
  `Mon Aug 31 01:29:49 2026`, cwd
  `<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`,
  directory mtime `1788110959`; `/` and `/agents/integration` remained HTTP 200.

## Implemented qualification controls

- `pilot:qualification:check` re-verifies immutable publisher business-adoption
  signatures and their task, publisher, artifact and report binding.
- At least three useful adopted tasks, three publishers, three Agent wallets,
  publisher-Agent separation, collaboration and competition adoption, quorum
  dispute resolution, one complete day 7/30/90 maintenance lifecycle and an
  observed repeated-combination reward decay are mandatory.
- Six distinct EIP-191 signer wallets cover publisher independence, Agent
  independence, support, disputes, incident response and rollback.
- Every signature binds chain ID 97, pilot ID, exact deployment-manifest SHA-256,
  normalized pilot task-set hash, role, subjects, evidence SHA-256 and timestamp.
- Only canonical events belonging to the signed task set can satisfy lifecycle
  gates. Unknown tasks, task/deployment/subject substitution, duplicate tasks,
  cross-role signers, self-review, incomplete review coverage, future timestamps
  and sign-off before the final adoption are rejected.
- The sign-off file is bounded to 512 KiB, must be a non-symlink regular file and
  must have no group/other permission bits. The deployment manifest is bounded to
  1 MiB. Both use an opened file handle for stat plus read.
- The private Admin API is dynamic and non-cacheable. The CLI closes PostgreSQL
  before exiting, including the expected exit-code-2 failure path.

## Fresh verification

- `pnpm lint`: pass.
- `pnpm test`: 118/118 tests across 28 files. The printed 100% metric still
  applies only to `src/lib/protocol.ts`; it is not represented as full-project
  coverage.
- `pnpm exec tsc --noEmit`: pass.
- `pnpm workers:build`: pass, 12 Worker bundles.
- `pnpm production:config`: pass; the unset local `EVALUATOR_AGENT_ID` warning is
  expected outside a populated production environment.
- `pnpm build`: pass; `/api/admin/pilot-readiness` appears in the production route
  manifest.
- `pnpm audit --prod`: no known vulnerabilities.
- `pnpm contracts:compile`: eight deployable contracts compiled.
- `pnpm contracts:test`: 9/9 complete on-chain lifecycle/adversarial tests passed
  in 499.01 seconds.
- A disposable PostgreSQL database named
  `agentgrid_pilot_gate_20260831_0449` migrated successfully. The qualification
  CLI correctly returned exit code 2 for missing deployment/pilot evidence and
  exited promptly after its database pool fix. The exact database was then
  dropped.
- `pnpm pilot:signoff:messages docs/pilot-signoff-draft.example.json`: pass; all
  six messages share the normalized task-set hash.

## Open external gates — launch remains disallowed

Fresh `pnpm contracts:deploy:check` reached chain ID 97 but returned
`broadcastReady:false` with:

- `THREE_ARBITRATORS_REQUIRED`
- `ARBITRATOR_QUORUM_INVALID`
- `DEPLOYER_PRIVATE_KEY_MISSING`
- `PROTOCOL_OWNER_ADDRESS_REQUIRED`
- `PROTOCOL_COORDINATOR_ADDRESS_REQUIRED`

Fresh `pnpm contracts:pilot:check` returned exit code 2 with
`BSC_TESTNET_DEPLOYMENT_FILE_MISSING`. Consequently there is no current evidence
of deployed bytecode, funded tBNB balances, five-confirmation transactions or
seven independently controlled participant wallets.

The remaining non-code gates are also open: three genuine business publishers,
independently operated Agents and six real signers; retained external evidence
preimages; production TLS/domain/WAF/trusted-proxy verification; external KMS
custody and recovery for all private keys; observed off-host encrypted backup and
restore alerting; and an independent Solidity plus Web/API security review with
all high/critical findings closed. Do not activate or expose the candidate until
every unchecked row in `docs/RELEASE_CHECKLIST.md` has authoritative evidence.
