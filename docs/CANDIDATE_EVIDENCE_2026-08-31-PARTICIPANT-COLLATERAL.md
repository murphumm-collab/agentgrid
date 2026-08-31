# AgentGrid unactivated candidate evidence — task-bound Agent collateral

Recorded 2026-08-31 (Asia/Hong_Kong). This evidence upgrades the local
production candidate so Agent stake is actual task collateral, and closes a
Redis heartbeat crash window. It is not BSC deployment or public-launch proof.

## Economic/security changes

- Every evaluator, executor and tester assignment reserves 100 AGT from the
  wallet's registered position in `StakeCreditManager`.
- A 1,000 AGT minimum position can back at most ten concurrent assignments;
  available collateral is checked again for every new random selection/claim.
- Any participant task lock blocks withdrawal and prevents the same stake
  position from issuing a publisher Task Credit.
- Evaluation expiry slashes each selected non-reporter by 1% of current stake,
  pays only actual reporters and releases all panel locks.
- An executor with no contribution six hours after claim/correction is slashed
  1%, unlocked and evicted before a replacement Agent can claim.
- Test failure releases the completed tester responsibility before a correction
  round. Publisher-win disputes release all remaining participant locks;
  maintenance completion releases the publisher and current participant locks.
- AgentRegistry and StakeCreditManager each accept task-collateral mutations only
  from their one-time-wired protocol counterpart. BSC deployment now has exactly
  17 recorded transactions, including both collateral wiring calls.
- Queue heartbeat ownership check, lease TTL extension and recovery-set deadline
  are one Redis Lua transaction. A process crash cannot create a renewed lease
  with no future redelivery record.

TaskRegistry compiles to 24,419 deployed bytes; the compiler rejects anything
above EIP-170's 24,576-byte limit. The exact six-contract runtime manifest is now
generated deterministically with `pnpm contracts:runtime-manifest` and its test
rejects stale hashes, wrong immutable positions and any changed opcode.

## Current uninterrupted QA evidence

Report:

```text
/Users/mo/Documents/codex/agent-incentive-lab/qa-evidence-participant-collateral-dI5FK8/application-qa.json
```

- Report SHA-256:
  `41d273c7ab8b25fa18bcac983bf55038db64414ca3b5d58ebabfecb45adcf2b1`
- Source SHA-256:
  `sha256:0a7ddc52c664bd6faa86b79a487c8294fc4a647c42e1d57a1e8cc7da0fc5d4d9`
- Candidate build ID: `liscLyX1J_PG6fvHGWqoe`
- Candidate directory:
  `/Users/mo/Documents/codex/agent-incentive-lab/local-releases/agentgrid-20260831T120237Z-liscLyX1`
- Candidate payload SHA-256:
  `sha256:f53b269ee116458bb0bae5d49d28724e2bc35fc6e1ac6c4ff636ea39ffd5f2d3`
- Candidate release-manifest SHA-256:
  `sha256:50018eb70c441fc90788c240163dabe9de19c2b086b7714d852938d585d2aa24`
- Candidate entries/bytes: `2567` / `69079421`
- Fixed commands: `22/22`, all exit code `0`
- Application tests: `189/189` across `48/48` files
- Solidity lifecycle/adversarial tests: `12/12`; QA-recorded duration
  `640660 ms`
- Worker/Ops bundles: `15`

The uninterrupted run also passed production Compose, Next build, file-only
Secret injection, PostgreSQL wallet sessions, atomic Redis queue recovery,
artifact integrity, sandboxed hidden tests, key rotation, reorg/outbox recovery,
encrypted Agent delivery, alert acknowledgement, trusted proxy, local KMS
recovery, database backup/restore and immutable candidate generation.

## Explicitly open internal gates

- A randomly selected tester who never submits still requires a task-preserving
  timeout/slash/reselection transition.
- A publisher who stays silent in `USER_REVIEW` still requires a deterministic
  non-hostage timeout policy.
- Both changes require modularizing TaskRegistry before adding new code; only 157
  deployed bytes remain. These rows are unchecked in `RELEASE_CHECKLIST.md` and
  this candidate must not be described as internally complete.

## External gates remain open

- Deployer `0x077A2e71d3EaB62F001Ad0Fff957f3627e6E78d1` still has 0 tBNB;
  no current contract was broadcast or verified on chain 97.
- Independent owner/coordinator/arbitrator/publisher/executor/tester custody,
  public TLS/WAF, external KMS, off-host recovery, alert receiver, independent
  audits, unrelated real-business pilots and final release signatures are absent.

`pnpm release:production:check` must remain red until every internal and external
row in the normative production completion definition has direct evidence.
