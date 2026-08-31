# AgentGrid bounded-JSON candidate evidence — 2026-08-31

## Candidate identity and isolation

- Build ID: `QxlG7ZkZ1NpOiSxyLvalV`
- Unactivated snapshot:
  `<agentgrid-workspace>/local-releases/agentgrid-20260830T184440Z-QxlG7ZkZ`
- `server.js` SHA-256:
  `92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac`
- Manifest: `immutableSnapshot:true`, `activationRequired:true`

The snapshot ran only on `127.0.0.1:3101`. `/`, `/tasks`, `/tasks/new`,
`/agents`, `/agents/integration`, and a referenced CSS asset returned HTTP 200.
The candidate then returned 415 for a JSON route with `text/plain`, 400 for
malformed JSON, and 413 for an oversized request sent with chunked transfer
encoding. Port 3101 was closed after verification.

The deployed port-3000 process remained PID `52463`, with its original start
time and working directory
`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`.
It was not restarted, replaced, or modified.

## Request-body controls

- All 25 JSON write routes use `readJsonBody`; no route calls the framework's
  unbounded `request.json()` path.
- The decoder accepts `application/json` and `application/*+json`, rejects
  compressed bodies, validates any declared length and counts actual streamed
  bytes so chunking cannot bypass the cap.
- UTF-8 is decoded in fatal mode. Empty, malformed, invalid UTF-8 and invalid
  length inputs are rejected before route authentication or business logic.
- Limits are 64 KiB by default, 128 KiB for Agent job completion and 256 KiB
  for signed verification evidence. The maximum configurable decoder limit is
  1 MiB.
- `apiError` maps malformed input to 400, excess size to 413, and unsupported
  media/encoding to 415 without exposing an internal error.

## Verification

- `pnpm lint`: passed.
- `pnpm test`: 20 files and 90 tests passed; five focused tests cover media
  types, compression, declared/chunked oversize bodies, fatal UTF-8, malformed
  JSON and empty bodies.
- `pnpm build`: passed on Next.js 15.5.24.
- `pnpm workers:build`: all 12 Worker/Ops bundles passed.
- `pnpm production:config`: passed; the missing local evaluator ID only produced
  the expected optional-profile warning.
- `pnpm production:secrets:smoke`: expanded 12 services, rejected plaintext
  secret environments, verified 11 external Secret definitions and role mounts,
  and ran the compiled Migration Worker using only temporary mode-0400 files.
- `pnpm agent:delivery:smoke`: a real standalone Web process returned the exact
  415/400/413 body-policy responses, including a no-length chunked oversize body;
  hard-crash lease recovery, encrypted artifact finalization, duplicate-complete
  rejection, file-backed readiness and temporary identity cleanup also passed.

## Remaining external gate

Application-level limits reduce per-request memory risk but do not prove public
ingress safety. Launch still requires observed TLS termination, WAF/rate limits,
redundant edge body limits and a trusted-proxy policy, as well as real KMS
custody/recovery, funded and verified BSC Testnet deployment, off-host
backup/alert traces, an independent Solidity/Web audit, and unrelated real-user
and independently operated Agent pilots.

Current BSC deployment blockers remain:

1. `THREE_ARBITRATORS_REQUIRED`
2. `ARBITRATOR_QUORUM_INVALID`
3. `DEPLOYER_PRIVATE_KEY_MISSING`
4. `PROTOCOL_OWNER_ADDRESS_REQUIRED`
5. `PROTOCOL_COORDINATOR_ADDRESS_REQUIRED`

**This candidate is not activated and is not approved for public production.**
