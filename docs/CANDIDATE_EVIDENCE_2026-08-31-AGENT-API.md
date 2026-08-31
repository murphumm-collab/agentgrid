# AgentGrid unactivated candidate evidence — external Agent API

Recorded 2026-08-31 (Asia/Hong_Kong). This record covers the GitHub/OpenAPI/SDK
integration repair and its local production-topology candidate. It is not BSC
deployment evidence and does not approve public production.

## Fixed integration failures

- The SDK previously advertised arbitrary/plain-text artifact media types while
  the production artifact service accepts only a bounded `.tar.gz` with
  `application/gzip`. `uploadArtifact` now fixes that media type, generates a
  fresh AES-256-GCM content key/IV, uploads ciphertext and finalizes the immutable
  manifest.
- The old exported SDK example called `/api/tasks/{id}/submit`, which is
  deliberately disabled in production. The example now claims on-chain, waits
  five confirmations, commits `submitContribution`, and calls `submitWork` for a
  single-executor collaboration before completing the queue lease.
- `examples/execute-encrypted-task.ts` is included in TypeScript compilation. It
  reads file-backed API/wallet secrets, discovers runtime chain configuration,
  prevents a duplicate claim after recovery, waits for the chain projection,
  uploads the encrypted archive and binds every completion to confirmed BSC
  transactions.
- `/.well-known/agentgrid.json` now advertises wallet session onboarding,
  runtime chain configuration, encrypted upload/finalize, team contribution and
  assigned-tester download endpoints.
- `/openapi.json` now documents those production operations and marks Agent keys,
  wallet sessions, signed URLs, encryption keys and tester-only decryption
  material at their actual trust boundaries. It contains 18 paths and 15 schemas.
- New contract tests ensure every advertised discovery route maps to a unique
  documented operation, production artifact fields remain AES-256-GCM/gzip, and
  wallet/Agent security schemes cannot silently disappear.

## Current uninterrupted QA evidence

Report:

```text
/Users/mo/Documents/codex/agent-incentive-lab/qa-evidence-agent-api-final-3D6Bst/application-qa.json
```

- Report SHA-256:
  `1fe4fcd35c860a2979da8e2beba9040e7cf9c045d80bc923c01eb26924946638`
- Source SHA-256:
  `sha256:93760a0ce42d5d84b9ae0046c53def29240e489178119c349bb8583522b8cd81`
- Candidate build ID: `IWLRGNOai5QPWfgniDzUs`
- Candidate directory:
  `/Users/mo/Documents/codex/agent-incentive-lab/local-releases/agentgrid-20260831T101316Z-IWLRGNOa`
- Candidate payload SHA-256:
  `sha256:9a4e5183271ec6a57cdf4a140d2243acdc7d55dffd16f3d299896a2f9909ed36`
- Candidate release-manifest SHA-256:
  `sha256:c3bfafc0df08f6cbc43d76044fd59d06f80da87ff887c9405c894f269e301f3b`
- Candidate entries/bytes: `2567` / `69071460`
- Fixed QA commands: `22/22`, every exit code `0`
- Application tests: `189/189` across `48/48` files
- Solidity regression: passed; recorded duration `582977 ms`
- Worker/Ops bundles: `15`

The same uninterrupted run also passed production Compose expansion, Next build,
file-only Secret injection, PostgreSQL wallet sessions, Redis lease recovery,
artifact integrity, tester sandboxing, Artifact Master Key rotation, reorg/outbox
recovery, production Agent delivery, acknowledged alert drill, trusted proxy, KMS
local recovery, database backup/restore and immutable candidate generation.

## Still-open production gates

This remains an unactivated local candidate. At minimum, all of the following
must remain red until independent evidence exists:

- the testnet deployer still has `0` tBNB; no current contract was broadcast;
- owner/coordinator/arbitrator/pilot wallets are not independently controlled and
  funded;
- no public TLS/WAF edge, external KMS, off-host restore or external alert
  receiver has been observed;
- no independent Solidity or Web/API audit is signed;
- three unrelated publishers and three independently operated Agents have not
  completed and signed real-business pilots;
- the final signed release bundle does not exist and
  `release:production:check` must not return ready.

The normative completion rule is
`docs/PRODUCTION_COMPLETION_DEFINITION_ZH.md`; this candidate does not satisfy it.
