# AgentGrid latest 22-command QA evidence — unactivated candidate

Recorded 2026-08-31 (Asia/Hong_Kong). This record describes a local production-
mode QA run. It is not evidence of a BSC deployment, real-user adoption,
independent audit, production edge, or external KMS custody.

## Immutable QA report

```text
report: <agentgrid-workspace>/release-evidence/application-qa-20260831-103118.json
mode: 0600
bytes: 12180
SHA-256: 78e354826ab31d587e03ca6248ef5acd1a66dcf5174ea48911ec7f12f9e205da
started: 2026-08-31T02:31:19.086Z
completed: 2026-08-31T02:41:56.359Z
duration: 637273 ms
scope: agentgrid-production-application-qa
commands: 22
failed commands: 0
source SHA-256: sha256:c405e35724012fd75f980ad84383f0e5e3cd970fd9a4c0c8da202b1aa0c377f5
```

The runner used a 30-minute per-command hard timeout. Unit tests, type checking,
lint, Solidity compilation and full regression, Worker/Compose/Web builds,
file-secret, PostgreSQL session, Redis lease, Artifact integrity, tester sandbox,
key rotation, reorg, Agent crash delivery, monitoring acknowledgement,
trusted-proxy, KMS recovery, database backup/restore and candidate snapshot all
exited with code 0. The report contains output hashes rather than local QA
credentials.

## Bound candidate

```text
build ID: YXCSZ99lrBtDst0kSlX5L
directory: <agentgrid-workspace>/local-releases/agentgrid-20260831T024154Z-YXCSZ99l
created: 2026-08-31T02:41:55.746Z
server SHA-256: 92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac
payload SHA-256: sha256:5e42eac1e7cc7f18f8dd64bd53b6e41d8d4de29e4dfe20a5d43a0041daf345f2
payload entries: 2542
payload bytes: 68702681
release-manifest SHA-256: sha256:bb7935639a9f9d99df389f00aabcf636fe030d769c87e611f5fa567cd913a38a
```

The manifest file was re-hashed independently after the QA run and matched the
digest embedded in the report. The candidate remains unactivated. Port 3000
continues to run PID 52463 from
`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`;
the QA runner did not restart or overwrite it.

## Current launch boundary

The live BSC Testnet RPC reports chain ID 97, but the configured testnet deployer
`0x077A2e71d3EaB62F001Ad0Fff957f3627e6E78d1` has zero balance and no
`contracts/deployments/bsc-testnet.json` exists. Deployment, bytecode/wiring
verification, independently controlled pilot wallets, real business adoption,
dispute/maintenance/decay evidence, external audits and three-role final release
signatures therefore remain open. The product must not be described as
production-ready until `pnpm release:production:check` exits 0.
