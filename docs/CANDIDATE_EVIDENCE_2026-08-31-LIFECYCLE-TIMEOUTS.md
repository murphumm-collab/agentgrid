# AgentGrid unactivated candidate evidence — lifecycle timeout closure

Recorded 2026-08-31 (Asia/Hong_Kong). This candidate closes the two remaining
known on-chain task-liveness gaps. It is not BSC deployment, independent audit or
real-business launch evidence.

## Rules implemented

- A randomly assigned tester receives a 24-hour on-chain deadline.
- Before the deadline, replacement reverts. At or after the deadline, any caller
  may trigger the transition; the caller cannot choose the next tester.
- The inactive tester loses 1% of current stake, its 100 AGT task lock is
  released, and that wallet is excluded from all later tester selections for the
  same task.
- The task preserves its artifact, executor team, work round and hidden-test
  commitment, then commits a new future-block candidate snapshot. Existing
  `TesterRequested` indexing queues the normal random-finalization path.
- After a successful independent test, the publisher receives a 72-hour on-chain
  review deadline. It may accept or submit a structured rejection during that
  window.
- At or after the deadline, any caller may finalize acceptance. The transition
  creates the same capped, weighted RewardVault Grant and emits `UserReviewed`
  with reason code `0x01`, making automatic acceptance distinguishable from the
  publisher's normal zero-reason acceptance.
- The production team-formation scheduler now also scans both deadline states
  and submits these permissionless transitions. Exact-deadline behavior has a
  pure unit test; the full-chain test proves early rejection, slash, unlock,
  re-randomization, replacement testing and automatic Grant creation.

TaskRegistry deploys at 24,548 bytes, below EIP-170's 24,576-byte maximum. The
28-byte margin is intentionally documented as a structural constraint: any new
feature must extract lifecycle/evaluation logic into a separate module before it
is added. The compiler and runtime-manifest gate reject oversized or stale code.

## Current uninterrupted QA evidence

Report:

```text
/Users/mo/Documents/codex/agent-incentive-lab/qa-evidence-lifecycle-timeouts-yQUyzz/application-qa.json
```

- Report SHA-256:
  `166ee256ae7b385a3303e6f60f4147d9ec1b1e34c8777fcc2aff4dd357063c9e`
- Source SHA-256:
  `sha256:5fd3577cea9bfa677e624570ca2da63769b32b4725207f3526e61469ea25fa97`
- Candidate build ID: `kp0orj84s6XV0-lUppKPX`
- Candidate directory:
  `/Users/mo/Documents/codex/agent-incentive-lab/local-releases/agentgrid-20260831T131009Z-kp0orj84`
- Server SHA-256:
  `92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac`
- Candidate payload SHA-256:
  `sha256:665a706bb3913ce11306f737216dad10ab81ad82cc8e1907cabb58a4b17a5a64`
- Candidate release-manifest SHA-256:
  `sha256:4cc3080e430c311165c96de90365df3b1615d578f1143dda2d360cf44addeb4a`
- Candidate entries/bytes: `2567` / `69080863`
- Fixed commands: `22/22`, all exit code `0`
- Application tests: `190/190` across `49/49` files
- Solidity lifecycle/adversarial tests: `13/13`; QA-recorded duration
  `705027 ms`
- Worker/Ops bundles: `15`

The run also passed production Compose and Next builds, file-only Secret
injection, PostgreSQL sessions, atomic Redis queue recovery, artifact integrity,
sandboxed hidden tests, key rotation, reorg/outbox recovery, encrypted Agent
delivery, alert acknowledgement, trusted proxy, local KMS recovery, database
backup/restore and immutable candidate generation.

## External production gates remain open

- BSC Testnet deployer `0x077A2e71d3EaB62F001Ad0Fff957f3627e6E78d1`
  still has `0` tBNB, so no current contract was broadcast or verified on chain
  97. Read-only preflight reports only `DEPLOYER_TBNB_UNDERFUNDED`.
- Independent owner/coordinator/arbitrator/publisher/executor/tester custody,
  public TLS/WAF, external KMS, off-host recovery, real alert receiver,
  independent Solidity/Web audits, three unrelated real-business pilots and
  final release signatures are absent.

`pnpm release:production:check` must remain red until those external preimages
exist and every remaining unchecked release row has direct evidence.
