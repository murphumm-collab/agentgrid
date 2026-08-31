# AgentGrid KMS custody/recovery hardening — unactivated candidate

Date: 2026-08-31 (Asia/Hong_Kong)

This evidence covers the provider-neutral KMS custody and recovery verifier added
to the source workspace. It does not claim that an external KMS has been
configured or that the product is ready for public production.

## Implemented gate

- The release gate parses a strict report for exactly four critical assets:
  artifact master key, protocol operator wallet, deployer wallet and evaluator
  wallet. It binds the report to the exact candidate build ID and deployment
  manifest SHA-256.
- A production report requires workload identity, absence of long-lived cloud
  credentials, customer-managed encryption, rotation, audit logging, deletion
  protection, a recovery window of at least seven days, distinct primary and
  recovery regions, least-privilege policies and current cross-region versions.
- The isolated verifier reads four exact mode-0400 files from a mode-0700,
  non-symlink recovery root; the report must be outside that mount and is created
  exclusively with mode 0600.
- Recovered values are checked against provider-observed one-way fingerprints.
  The artifact key completes an AES-256-GCM round trip. Three wallets sign a
  randomized challenge bound to BSC Testnet chain 97, candidate and deployment;
  recovered addresses must match the provider observation.
- The report contains hashes, public wallet addresses and control results only.
  It never contains recovered values. Production reports require at least four
  distinct provider audit-event hashes and an isolated recovery source.
- `local-smoke` observations are rejected by the production release gate even
  when all local cryptographic recovery checks succeed.

## Verification performed

- `pnpm test`: 38 files, 155/155 tests passed. The displayed 100% statement/line
  coverage applies only to `src/lib/protocol.ts`, not the whole application.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm lint`: passed.
- `pnpm workers:build`: passed with 15 Worker/Ops bundles including
  `kmsVerify.js`.
- `pnpm production:config`: passed for 13 services.
- `pnpm production:secrets:smoke`: passed for all 14 external Secret mounts.
- `pnpm build`: passed; Next generated 22 static pages and all dynamic routes.
- `pnpm ops:kms:smoke`: recovered four fresh values; AES and three wallet
  signature round trips passed; symlink root and report-inside-secret-mount were
  rejected; the report was 0600 and remained production-ineligible.
- `pnpm ops:monitor:drill:smoke`, `pnpm ops:proxy:smoke`, and
  `pnpm audit --prod --audit-level high`: passed; no known production dependency
  vulnerabilities were reported.

The persisted local report is outside the source tree:

```text
<agentgrid-workspace>/release-evidence/kms-custody-local-smoke-20260831-0702.json
SHA-256 79520d49f01f4a476826738ab93500626287dae9ffff4cfd2aba8260adeb144f
mode 0600; 5083 bytes
```

## New immutable candidate

```text
build ID: tw97fJDq0bOvS-B8TCrZP
directory: <agentgrid-workspace>/local-releases/agentgrid-20260830T230159Z-tw97fJDq
server SHA-256: 92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac
payload SHA-256: sha256:e2700c44363a778b199eeb7e44ae9ab0f64c72798973712961d1241eeb43143b
payload entries: 2542
payload bytes: 68656183
release-manifest SHA-256: 88f613d51eb4d6aed996c3f447aaa134fdebd64e387ab28271d96a086480cc52
```

The payload was re-hashed after sealing and matched the manifest. The candidate
was started only on `127.0.0.1:3101`; `/`, `/agents`, `/agents/integration`,
`/tasks`, `/tasks/new`, health and a build-specific static asset were verified.
The Chinese Agent API page was verified with the locale cookie. The private
release-readiness route returned HTTP 200 with
`productionReleaseReady:false` and `verifiedCustodyAssets:0`, correctly reflecting
missing external evidence. Port 3101 was then stopped.

The active deployment was not modified, restarted or replaced. PID 52463 remains
on port 3000 from:

```text
<agentgrid-workspace>/local-releases/agentgrid-20260831-0129
```

Both `/` and `/agents/integration` still returned HTTP 200 after candidate
verification.

After the focused KMS candidate above, one uninterrupted 22-command application
QA run completed for the final source state. It produced report
`application-qa-20260831-0705.json` (SHA-256
`2519f0d90ba0e00616bd2f86d588b7c70134c5021fa1f8c866c1a40d6754e34f`)
and bound the later candidate `cUcq_1aEkV-qZ7lEDyIAB`. That candidate supersedes
the focused candidate for further release evidence. It was also verified only on
3101 and stopped; port 3000 remained unchanged.

## Still-open external and final gates

- Provision the four assets in a real external KMS/secret manager, retain the
  provider policy and audit exports, and run the isolated cross-region/version
  recovery job against this exact final candidate and deployment.
- Fund independent testnet wallets with tBNB, deploy and verify the current
  contracts on BSC Testnet, then complete the real lifecycle and signed pilot.
- Configure and observe production TLS/WAF/trusted proxy, off-host KMS-encrypted
  restore and the external incident receiver.
- Complete independent Solidity and Web/API audits and close all high/critical
  findings.
- Obtain real publisher/Agent adoption and the required pilot/release signatures.

The external KMS report is an operator observation bound into a three-party
signed release, not a cloud-provider cryptographic attestation. Reviewers must
inspect the retained provider exports; a locally manufactured report is not
sufficient.
