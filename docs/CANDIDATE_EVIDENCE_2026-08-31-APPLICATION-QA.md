# AgentGrid application QA evidence — unactivated candidate

Recorded 2026-08-31 (Asia/Hong_Kong). This is a local production-topology QA
result. It is not BSC deployment, external infrastructure, independent audit or
real-user pilot evidence.

## Immutable evidence

- QA report:
  `<agentgrid-workspace>/release-evidence/application-qa-20260831-0533.json`
- Report mode: `0600`; bytes: `10464`.
- Report SHA-256:
  `c2b6b1ba360f5ee9e1f2151e56a513c87ca332ad0c0adace379845527f2187e6`.
- Source-tree SHA-256:
  `sha256:fbfd66951dffe6eb0442852bd6c3f7b64a131ab962db2fd653e138e58e9315e4`.
- Started: `2026-08-30T21:45:22.024Z`.
- Completed: `2026-08-30T21:55:08.791Z`.
- Continuous duration: `586.767` seconds.

## Bound candidate

- Build ID: `c1ztBhGXxidI-seEuRNw_`.
- Snapshot:
  `<agentgrid-workspace>/local-releases/agentgrid-20260830T215507Z-c1ztBhGX`.
- Candidate manifest SHA-256:
  `sha256:e51f9cc16732f80303b717b12a02d9c727b80084c5f4d737d2a4093d14ff79e4`.
- Server SHA-256:
  `92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac`.
- Manifest states `immutableSnapshot:true` and `activationRequired:true`.

## One-run command evidence

All 19 fixed commands exited 0 in order. The report records each exact argument,
environment profile, start/end/duration, exit code, and bounded stdout/stderr
SHA-256. It contains no private key or raw Secret.

1. Unit tests: 32 files, 130 tests; isolated demo test profile.
2. TypeScript check.
3. ESLint.
4. Eight-contract compilation.
5. Full Solidity lifecycle/adversarial regression (`499.059` seconds).
6. Twelve Worker bundles.
7. Production Compose expansion.
8. Next production build; 21/21 static pages.
9. File-only Secret topology smoke: 12 services and 11 external Secrets.
10. PostgreSQL/session/business-adoption smoke.
11. Redis lease/crash recovery smoke.
12. Immutable Artifact checksum/substitution smoke.
13. No-network read-only tester sandbox smoke.
14. Artifact envelope-key rotation smoke.
15. Reorg/outbox/queue provenance smoke.
16. Agent hard-crash/encrypted-delivery/request-limit smoke.
17. PostgreSQL backup.
18. Checksum verification plus ten-table restore.
19. Candidate snapshot creation.

Two earlier attempts correctly failed without producing a successful report:
the first exposed unit-test environment contamination, and the second exposed a
direct-Secret leak into the file-only Secret smoke. The executor now binds three
explicit profiles (`demo-test-isolation`, `file-secret-isolation`, and
`qa-production-runtime`); tests reject profile substitution.

## Candidate HTTP verification

The bound candidate was started only on `127.0.0.1:3101` and stopped afterward.

- `/`, `/tasks`, `/tasks/new`, `/agents`, `/agents/integration`: HTTP 200.
- `/api/admin/release-readiness` without a credential: HTTP 401.
- Authorized response: HTTP 200, private/no-store and
  `productionReleaseReady:false` because external launch evidence is absent.

## Deployment isolation

- Existing PID `52463` retained its original start time and working directory:
  `<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`.
- Existing `/` and `/agents/integration` remained HTTP 200.
- Port 3101 had no listener after verification.
- No candidate was activated and no BSC transaction was broadcast.

## Open production gates

`pnpm release:production:check` still exits 2 with 20 explicit blockers. The
remaining evidence includes the actual BSC Testnet deployment and funded
independent wallets, real-business pilot and six-role sign-off, target TLS/WAF/
proxy and KMS drills, off-host backup/alert observation, independent Solidity
and Web/API reports, image-registry provenance, and three final release
signatures. This candidate must remain unactivated until that command exits 0.
