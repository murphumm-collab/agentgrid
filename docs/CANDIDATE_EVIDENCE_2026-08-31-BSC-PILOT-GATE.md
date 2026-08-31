# Candidate evidence: BSC pilot gate

Date: 2026-08-31 (Asia/Hong_Kong)

Candidate snapshot:

`<agentgrid-workspace>/local-releases/agentgrid-20260830T192304Z-Da0THF8E`

This snapshot is immutable and **not activated**. The existing service on port
3000 remained PID 52463, start time `Mon Aug 31 01:29:49 2026`, and working
directory
`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`
before and after candidate verification. `/` and `/agents/integration` returned
HTTP 200.

## Candidate smoke

The candidate ran only on `127.0.0.1:3101`. `/`, `/agents`,
`/agents/integration`, `/stake`, `/tasks`, and `/tasks/new` returned HTTP 200.
Without deployed contract addresses, `/api/chain/config` failed closed with HTTP
409 and `CHAIN_CONTRACT_ADDRESSES_REQUIRED`. Port 3101 was closed afterward.

## BSC Testnet chain pilot gate

- The preflight accepts only a public HTTPS RPC, rejects local/private addresses
  both syntactically and after DNS resolution, and verifies chain ID 97, the
  known BSC Testnet genesis hash, and a head no more than five minutes old.
- Seven role wallets are required: publisher, three evaluators, executor,
  tester, and coordinator. They must be distinct; non-coordinator roles cannot
  overlap owner, reserve, coordinator, or arbitrators. Every wallet must have at
  least the configured tBNB minimum.
- Deployment verification compiles the current Solidity source and compares the
  complete deployed runtime bytecode. Only solc-declared immutable ranges are
  normalized. Non-empty but unrelated code is rejected.
- Ownership, coordinator, registry/vault/resolver wiring, reserve funding,
  distinct arbitrators, quorum, and pristine task/agent state are checked before
  any transaction can be sent.
- The broadcaster requires the exact explicit acknowledgement, stores each
  transaction hash atomically before waiting for five confirmations, and can
  resume only from an evidence file inside `contracts/pilot-runs` bound to the
  same deployment digest and role addresses.
- Evidence is deliberately labelled
  `synthetic-onchain-lifecycle-not-real-business-acceptance`. Passing it cannot
  be represented as an independent security audit or real-user acceptance.

No BSC transaction was broadcast in this evidence run. Current read-only gates
correctly report:

- deployment check: `broadcastReady:false` — `THREE_ARBITRATORS_REQUIRED`,
  `ARBITRATOR_QUORUM_INVALID`, `DEPLOYER_PRIVATE_KEY_MISSING`,
  `PROTOCOL_OWNER_ADDRESS_REQUIRED`, and
  `PROTOCOL_COORDINATOR_ADDRESS_REQUIRED`;
- pilot check: `executionReady:false` —
  `BSC_TESTNET_DEPLOYMENT_FILE_MISSING`.

## Verification results

- `pnpm contracts:test`: 9/9 complete Solidity lifecycle/adversarial tests
  passed, including runtime bytecode/source binding (483.48 seconds).
- `pnpm test`: 24 files and 101 tests passed. The coverage display is scoped to
  `src/lib/protocol.ts`, not the whole repository.
- `pnpm build`: successful production Next.js build; the Agent API integration
  page and all task/wallet routes were emitted.
- `pnpm lint`: passed.
- `pnpm contracts:compile`: eight contracts compiled.
- `pnpm contracts:pilot:typecheck`: passed.
- `pnpm workers:build`: twelve production worker artifacts built.
- `pnpm agent:delivery:smoke`: passed bounded JSON/binary uploads, encrypted
  sealing, crash recovery, duplicate completion rejection, runtime browser chain
  configuration, and five-confirmation wallet policy.
- `pnpm production:secrets:smoke`: passed all 12 services, 11 external secrets,
  file-secret enforcement, and role-specific mounts.
- `pnpm production:config`: passed (the optional local evaluator agent ID was
  unset and expanded to an empty value).
- `pnpm audit --prod --audit-level high`: no known vulnerabilities.

## Remaining launch evidence

This candidate does not satisfy the production launch gate until there is a
funded BSC Testnet deployment, a completed synthetic-chain evidence file, an
independent contract/security review, observed target TLS/WAF/KMS/off-host
backup controls, and unrelated users and independently operated Agents completing
real useful tasks.
