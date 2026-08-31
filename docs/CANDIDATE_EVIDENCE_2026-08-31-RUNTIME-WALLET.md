# AgentGrid runtime-wallet candidate evidence — 2026-08-31

## Candidate identity and isolation

- Build ID: `BD7E7a3smb8wS4wXR0w4o`
- Unactivated snapshot:
  `<agentgrid-workspace>/local-releases/agentgrid-20260830T185937Z-BD7E7a3s`
- `server.js` SHA-256:
  `92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac`
- Manifest: `immutableSnapshot:true`, `activationRequired:true`

The snapshot ran only on `127.0.0.1:3101`. `/`, `/stake`, `/tasks/new`,
`/agents`, `/agents/integration`, and a referenced CSS asset returned HTTP 200.
No built browser asset contained a `NEXT_PUBLIC_*` contract-address or
WalletConnect configuration reference. In demo mode without contract addresses,
`/api/chain/config` failed closed with `CHAIN_CONTRACT_ADDRESSES_REQUIRED` rather
than returning a partial configuration. Port 3101 was closed after verification.

The deployed port-3000 process remained PID `52463`, with its original start
time and working directory
`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`.
It was not restarted, replaced, or modified.

## Production publishing and wallet controls

- A strict runtime endpoint exposes only BSC Testnet chain ID 97, the configured
  confirmation count, five checksummed public contract addresses and the optional
  public WalletConnect project ID.
- Stake, Agent registration, task publication, review, rejection response,
  maintenance validation and reward claims all resolve addresses at runtime and
  use the same five-confirmation policy as indexer/workers.
- The compiled image no longer needs contract addresses to be known during
  `next build`; stale or empty build-time public variables cannot redirect wallet
  actions.
- A sealed task commitment is persisted in browser storage before wallet
  submission. The transaction hash is persisted immediately after broadcast and
  before confirmation waiting. Refresh/RPC interruption resumes the exact hash;
  only a never-broadcast or confirmed-reverted transaction can be sent again.
- Hidden-test upload uses streamed byte counting with the declared manifest size
  as its cap and a 10 MiB protocol maximum. Missing `Content-Length` cannot cause
  an unbounded allocation.

## Verification

- `pnpm lint`: passed.
- `pnpm test`: 22 files and 96 tests passed.
- `pnpm build`: passed on Next.js 15.5.24; `/api/chain/config` is present in the
  production route manifest.
- `pnpm workers:build`: all 12 Worker/Ops bundles passed.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities found.
- `pnpm production:config`: passed; the unset local evaluator profile produced
  only its expected warning.
- `pnpm production:secrets:smoke`: expanded 12 services, rejected plaintext
  secret environments and verified all 11 role-scoped external Secret mounts.
- `pnpm agent:delivery:smoke`: a compiled standalone production Web process was
  started with server runtime addresses only. It returned all five addresses,
  chain ID 97, the public WalletConnect ID and five-confirmation policy; bounded
  chunked JSON and authenticated hidden-test binary uploads returned 413. Hard
  crash recovery, encrypted artifact finalization, duplicate completion rejection
  and file-backed readiness also remained green.

## Remaining external gate

This candidate fixes a production-image configuration failure, but it does not
provide the external authority required to deploy. Launch still requires funded
BSC Testnet wallets and tBNB, distinct owner/coordinator/three-arbitrator
addresses, actual deployment and verified wiring, target KMS custody/recovery,
external TLS/WAF/trusted-proxy and off-host backup/alert observations, an
independent Solidity/Web audit, and unrelated real publisher/Agent pilots.

Current BSC deployment blockers remain:

1. `THREE_ARBITRATORS_REQUIRED`
2. `ARBITRATOR_QUORUM_INVALID`
3. `DEPLOYER_PRIVATE_KEY_MISSING`
4. `PROTOCOL_OWNER_ADDRESS_REQUIRED`
5. `PROTOCOL_COORDINATOR_ADDRESS_REQUIRED`

**This candidate is not activated and is not approved for public production.**
