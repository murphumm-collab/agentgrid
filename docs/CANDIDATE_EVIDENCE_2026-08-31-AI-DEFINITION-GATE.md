# Candidate evidence — server-bound AI definition gate

Date: 2026-08-31

This is local candidate evidence, not BSC deployment, external audit or real-user
pilot evidence.

## Control added

Production task publication now requires successful structured reports from an
external requirements-writer AI and an external validation-critic AI. A ready
result is persisted with:

- the authenticated publisher wallet;
- the exact title, business outcome, category and completion-definition hash;
- complete private review preimages plus their committed report hashes;
- the readiness assessment and a two-hour expiry;
- one-time consumption and the resulting commitment UUID.

The task specification includes the review UUID. Commitment creation checks and
consumes the review in the same PostgreSQL transaction that binds the sealed
hidden-test manifest. Missing, expired, cross-publisher, changed and replayed
reviews fail before hidden-test consumption.

The sealed commitment no longer depends on browser local storage for recovery.
An authenticated GET returns the unresolved server commitment, recent BSC logs
are reconciled by publisher plus spec hash, and the wallet transaction hash is
bound idempotently before confirmation. A different hash is rejected. Clearing
the binding requires a canonical reverted receipt read by the server; after a
browser crash with no known hash, a two-minute fail-closed reconciliation delay
prevents an immediate duplicate broadcast.

## Verification

- `pnpm test`: 181 tests across 45 files passed.
- `pnpm production:secrets:smoke`: 13 services, 15 external Secret mounts, no
  direct sensitive environment variables, and a successful file-only migration.
- `pnpm reorg:queue:smoke`: changed, cross-publisher, expired and replayed
  definition reviews were rejected alongside the canonical reorg checks.
- `pnpm agent:delivery:smoke`: a real standalone production Web process called
  two local external-AI fixtures over the configured provider boundary, issued a
  ready review, created one exact task commitment and rejected its replay. The
  existing crash recovery and encrypted artifact path also passed.
- Container-path backup and streamed restore found all 11 delivery/lifecycle
  core tables, including `task_definition_reviews`.
- One uninterrupted `pnpm release:qa:run` passed all 22 fixed commands, including
  the real standalone-Web crash recovery flow, and bound unactivated candidate
  `0tCFYaVSMa3XoMJUWKw7M` at
  `/Users/mo/Documents/codex/agent-incentive-lab/local-releases/agentgrid-20260831T061202Z-0tCFYaVS`.

QA report SHA-256:
`9fabf0f8e8d2be41d058093e51273fca5b4a0e96dbb1110c9c69cf0d4400cc93`

Source SHA-256:
`sha256:9b0584b15410e0a740186dfdc3a05bdaadffb0f1394da7efc04548a314dae266`

Candidate manifest SHA-256:
`sha256:2bb5ab489ac55fb60d58636eefee7ea93ef7f39ef63e46f4ee6ba996ea8a4f7f`

## External gates still open

The BSC Testnet preflight still reports deployer
`0x077A2e71d3EaB62F001Ad0Fff957f3627e6E78d1` at `0 tBNB`, below the
`0.1 tBNB` broadcast threshold. No transaction was broadcast. Independent
Solidity/Web audits, production edge/KMS/off-host evidence and independently
controlled real-business pilots also remain open.
