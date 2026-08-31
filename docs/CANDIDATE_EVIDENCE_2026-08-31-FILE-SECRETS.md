# AgentGrid file-secret candidate evidence — 2026-08-31

## Candidate identity and isolation

- Build ID: `BtjxkrD15nSUUKp54jXSo`
- Unactivated snapshot:
  `<agentgrid-workspace>/local-releases/agentgrid-20260830T183649Z-BtjxkrD1`
- `server.js` SHA-256:
  `92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac`
- Manifest: `immutableSnapshot:true`, `activationRequired:true`

The snapshot ran only on `127.0.0.1:3101`. Five pages and a referenced static
CSS asset returned HTTP 200; the Agent API page rendered
`REQUIRE_FILE_SECRETS` and `AGENT_API_KEY_FILE`. Port 3101 was then closed.

The deployed port-3000 process remained PID `52463`, with its original start
time and working directory
`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`.
Its home and Agent integration pages still returned HTTP 200. It was not
restarted, replaced, or modified.

## File-secret controls

- Production Compose sets `REQUIRE_FILE_SECRETS=true` and declares 11 external
  Secrets with role-specific mounts.
- PostgreSQL and MinIO use their documented `*_FILE` entry points. Web,
  coordinator, evaluator and monitor processes receive only their declared
  file paths; sensitive values are absent from expanded service environments.
- AgentGrid rejects direct-plus-file conflicts, relative/non-regular files,
  files larger than 64 KiB, group/other-writable files, NUL/empty content and
  known placeholder values.
- Secret file contents are passed to the configuration schema without being
  copied into `process.env`.
- `/api/health/ready` contains a mandatory `fileBackedSecrets` production check.
- Deployment, operator, evaluator, executor/tester, alert and backup credentials
  support file-backed reads; production policy rejects direct secret values.

## Verification

- `pnpm test`: 19 files and 85 tests passed.
- `pnpm lint`: passed.
- `pnpm build`: passed on Next.js 15.5.24.
- `pnpm workers:build`: all 12 Worker/Ops bundles passed.
- `pnpm production:config`: passed with evaluator profile configuration.
- `pnpm production:secrets:smoke`: expanded 12 services, rejected plaintext
  secret environments, verified 11 external Secret definitions and role mounts,
  then started the compiled Migration Worker using only temporary mode-0400
  database/session files against an isolated database.
- `pnpm agent:delivery:smoke`: production Web readiness reported
  `fileBackedSecrets:true`; hard-crash job recovery and encrypted Artifact
  finalization passed using temporary PostgreSQL and MinIO identities. All
  temporary schemas, roles, object-storage users and objects were removed.
- `pnpm contracts:deploy:check`: BSC Testnet RPC and chain ID 97 passed; no
  transaction was broadcast.

## Remaining external gate

The code now provides a file-only boundary suitable for a deployment platform's
KMS/secret manager, but this is not proof of target custody. Launch still requires
observed KMS access policy, workload identity, recovery and rotation; funded BSC
Testnet deployment plus verified contract wiring; off-host backup/alert traces;
independent Solidity/Web audit; and unrelated real-user/Agent pilots.

Current deployment blockers remain:

1. `THREE_ARBITRATORS_REQUIRED`
2. `ARBITRATOR_QUORUM_INVALID`
3. `DEPLOYER_PRIVATE_KEY_MISSING`
4. `PROTOCOL_OWNER_ADDRESS_REQUIRED`
5. `PROTOCOL_COORDINATOR_ADDRESS_REQUIRED`

**This candidate is not activated and is not approved for public production.**
