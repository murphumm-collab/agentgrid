# AgentGrid 22-command application QA — unactivated candidate

Recorded 2026-08-31 (Asia/Hong_Kong). This is local production-topology evidence
for the exact source and candidate below. It is not BSC deployment, external
infrastructure, independent audit or real-user pilot evidence.

## Immutable report

```text
report: <agentgrid-workspace>/release-evidence/application-qa-20260831-0705.json
mode: 0600
bytes: 12178
SHA-256: 2519f0d90ba0e00616bd2f86d588b7c70134c5021fa1f8c866c1a40d6754e34f
started: 2026-08-30T23:38:11.549Z
completed: 2026-08-30T23:48:05.121Z
duration: 593572 ms
source SHA-256: sha256:1d6ed838b3adaea97e478046ba04461bf0173df0d764c720299834401b21bd6f
commands: 22
```

The report passed strict schema/time/order validation. It contains only command
output hashes; the local QA database password, session key, artifact key and
Admin key were not present.

## Bound candidate

```text
build ID: cUcq_1aEkV-qZ7lEDyIAB
directory: <agentgrid-workspace>/local-releases/agentgrid-20260830T234803Z-cUcq_1aE
server SHA-256: 92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac
payload SHA-256: sha256:55be93afc9fd8e7157b0e5f08dbc6ff4a43cc9cef4846074599bdc1f25488142
payload entries: 2542
payload bytes: 68656192
release-manifest SHA-256: sha256:cbe049978b4cd3cf47b4c267a2f22273dadc2024e0e63c95d1b184d55183b7a1
```

The sealed payload and permissions were independently re-verified after the QA
run and matched the report. The candidate root is read-only; only the declared
`.next/cache` path is mutable.

## Ordered gates passed

1. 155 application tests across 38 files.
2. TypeScript validation.
3. ESLint.
4. Eight-contract compilation.
5. Nine complete Solidity lifecycle/adversarial tests (`498470` ms).
6. Fifteen Worker/Ops bundles.
7. Thirteen-service, fourteen-Secret production Compose expansion.
8. Next production build with 22 static pages and all dynamic routes.
9. File-only Secret topology and bundled migration Worker.
10. Repeatable PostgreSQL/session/business-adoption smoke.
11. Redis lease/crash recovery smoke on isolated DB 13.
12. Immutable Artifact checksum/substitution smoke.
13. No-network read-only tester sandbox.
14. Artifact envelope-key rotation.
15. Reorg/outbox/queue provenance on isolated Redis DB 14 and PostgreSQL schema.
16. Agent hard-crash, encrypted delivery and request-limit smoke.
17. Signed alert/reminder/recovery acknowledgement drill.
18. Authenticated trusted-proxy/spoof-overwrite/direct-origin drill.
19. Four-asset KMS recovery smoke, deliberately production-ineligible.
20. PostgreSQL custom-format backup.
21. Checksum verification and ten-table restore.
22. Immutable candidate snapshot and full payload re-hash.

## Failures exposed and fixed before the successful run

- `production:smoke` reused a globally unique fixed adoption `report_hash`, so a
  second run failed. It now generates fresh 32-byte report hashes and passed
  twice consecutively before the final QA.
- Reorg smoke variables were discovered only after the long contract suite. The
  QA runner now fails before command one unless production DB/Redis, distinct
  reorg Redis, keys and an outside-workspace backup directory are explicit.
- Trusted-proxy smoke inherited direct Secrets from the parent QA environment.
  It now purges every common runtime Secret and `*_FILE` source before injecting
  only its own four mode-0400 files. It passed inside the final full environment.

No partial results from the three failed attempts were combined with this
report. Each failed attempt created no successful report; the final evidence was
produced by one uninterrupted run from command 1 through command 22.

## Candidate HTTP verification and deployment isolation

The bound candidate was started only on `127.0.0.1:3101` and then stopped.

- `/`, `/agents`, `/agents/integration`, `/tasks`, `/tasks/new`, and liveness:
  HTTP 200.
- Build-specific static asset: HTTP 200.
- Chinese Agent API labels and `x-agent-id`/`x-agent-key`: present.
- CSP with per-request nonce and `upgrade-insecure-requests`: present.
- Authorized release readiness: HTTP 200,
  `productionReleaseReady:false`, `verifiedCustodyAssets:0`, 20 blockers.

The active deployment was never modified or restarted. PID 52463 remains on port
3000 from
`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`;
its `/` and `/agents/integration` routes remained HTTP 200. Port 3101 has no
listener after verification.

## Remaining launch gates

- Funded, role-separated tBNB wallets and actual BSC Testnet deployment,
  bytecode/wiring verification and lifecycle evidence.
- Three real publishers and independently operated Agents, including signed
  business adoption, dispute, maintenance and both collaboration/competition.
- External TLS/WAF/origin isolation, real incident receiver, off-host
  KMS-encrypted restore, and target four-asset KMS recovery observation.
- Independent Solidity and Web/API audits with all high/critical findings closed.
- Immutable image-registry digests, pilot sign-off, and three final release
  signatures over the exact 12-preimage bundle.

The product remains not approved for public production until the final release
gate returns `productionReleaseReady:true`.
