# Runtime contract readiness candidate evidence — 2026-08-31

## Scope

This evidence covers the production readiness change that binds the Web runtime
to the exact current compiler output for all six BSC deployment contracts. It
does not claim a real BSC Testnet deployment, independent audit, external KMS,
public edge validation or real-user acceptance.

The source workspace was
`/Users/mo/Documents/codex/agent-incentive-lab/protocol-app`. Existing frozen
showcase processes were not restarted or modified.

## Security behavior

- `src/generated/runtime-contract-manifest.json` records the exact solc version,
  contract name, immutable references and normalized runtime hash for TestToken,
  StakeCreditManager, AgentRegistry, RewardVault, TaskRegistry and
  DisputeResolver.
- `src/lib/runtime-contract-verification.ts` validates the static manifest,
  normalizes only compiler-declared immutable ranges and rejects malformed,
  missing, old, unrelated or changed runtime bytecode.
- Production `/api/health/ready` loads all six server-configured addresses. It
  reports `contractsDeployed:true` only when chain ID and all normalized hashes
  match. The DisputeResolver is verified server-side and is not exposed through
  the browser wallet configuration.
- The production delivery smoke served six current compiled runtimes, observed
  HTTP 200 readiness, changed the first non-immutable token opcode, observed HTTP
  503 with `bscRpc:true` and `contractsDeployed:false`, restored the runtime and
  observed readiness recover.
- The publication evaluation notice now matches the contract: requesting an
  evaluation immediately occupies the Task Credit and charges the non-refundable
  3 AGT evaluator fee; approval later charges the separate publication fee;
  rejection or expiry releases the Credit.

## Focused verification

The following completed before the uninterrupted release run:

- TypeScript typecheck: passed.
- ESLint: passed.
- Runtime manifest/compiler drift tests: 2/2 passed.
- Application tests: 183/183 passed before the final environment-address test;
  the uninterrupted run then passed the final 184/184 suite.
- Production Next.js build: passed.
- 15 Worker/Ops bundles: passed.
- Production Compose and file-Secret smoke: passed.
- Production dependency audit at high severity: no known vulnerabilities.
- Agent delivery smoke: passed exact-runtime acceptance, opcode-mismatch
  rejection and recovery.
- Solidity lifecycle/adversarial regression: 11/11 passed in 577.23 seconds.

## Uninterrupted application QA

One new `pnpm release:qa:run` completed without source changes or interruption:

```text
started:  2026-08-31T07:31:25.268Z
finished: 2026-08-31T07:43:26.143Z
commands: 22/22 passed
report:   /Users/mo/Documents/codex/agent-incentive-lab/qa-evidence-runtime-a5EGoL/application-qa.json
mode:     0600
```

Evidence bindings:

```text
report SHA-256:
f84d2f3bd9ec7fdcee07e9b4227f9f853752d9212137feba90f7282f6a0f5b07

source SHA-256:
sha256:efaa16bf9e9eab43729c5c505bd07fe41fb7b9a29fd1018975f76b233742f730

candidate buildId:
f1TFX2x3hw1vN5FhI4VWe

candidate directory:
/Users/mo/Documents/codex/agent-incentive-lab/local-releases/agentgrid-20260831T074324Z-f1TFX2x3

server SHA-256:
92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac

payload SHA-256:
sha256:f1a4b9b6a6839aaaa068c068dad5c384003833428c6e30447f52996fa95d245e

release manifest SHA-256:
sha256:4eaecfad4c9ab993613ee5e5859b1fa5eead4a29e66e9f56531d7fde5036d989
```

The candidate contains 2,567 sealed payload entries and 69,057,827 payload
bytes. Its release manifest is read-only. It is unactivated and does not replace
either existing showcase process.

## Open production gates

- BSC Testnet deployer balance remains zero; no transaction was broadcast.
- Current contracts do not yet have confirmed and archived BSC Testnet addresses.
- Independent Owner/Coordinator/Arbitrator and seven Pilot role wallets remain
  externally unproven.
- Public domain/TLS/WAF, external KMS, off-host restore and real alert receiver
  evidence remain open.
- Independent Solidity and Web/API audits remain open.
- Unrelated publishers and independently operated Agents have not completed and
  signed real-business pilots.

This evidence upgrades the local production candidate only. It must not be used
to describe AgentGrid as a completed public production launch.
