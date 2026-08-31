# AgentGrid contract hardening and 22-command QA evidence

This document records an unactivated candidate. It does not claim that the
candidate replaced the process serving port 3000.

## Bound evidence

- QA report: `<agentgrid-workspace>/release-evidence/application-qa-20260831-081727.json`
- QA report mode: `0600`
- QA report SHA-256: `ae60526eec32940effd991e2e998cb0a2c70dbb78c45001e70c34ea783b2fe2e`
- Source SHA-256: `sha256:8717db3ce54285b38f3aa5439060f81c131e147b70c7303d85b1cc35dade3e35`
- Commands passed: `22/22`
- Candidate build ID: `PwM994L4VfzlYVIvZbTiq`
- Candidate directory: `<agentgrid-workspace>/local-releases/agentgrid-20260831T002831Z-PwM994L4`
- Server SHA-256: `92c23a4d618266e06d5977314ad8aff8c989d9aee823c5eb27ca6fc28e15feac`
- Payload SHA-256: `sha256:e8c77df0cc72b671e983013bc6eb43b4f3f36893ba50c7ec5dfb519163f24ad7`
- Release-manifest SHA-256: `sha256:085dcede538293ab0cd699b23abc2d12314d6211aa1b787f904234c1622cf660`
- Payload entries/bytes: `2542 / 68656773`

## Contract invariants added

1. Collaboration decay uses a claim-order-independent canonical team hash
   without changing the executor order used by signed reward weights.
2. Contributions become immutable once the current work round is team-ready.
3. Successful and failed test submissions require a non-zero evidence hash.
4. A correction round resets executor inactivity timers, preventing immediate
   eviction after a late maintenance failure.
5. Maintenance success and failure both enforce the checkpoint due time.
6. Competition rejection responses are restricted to the selected winner.
7. Reward decay is applied after the publisher stake cap, producing the fixed
   repeated-collaboration sequence `200, 140, 80, 40, 20` in the regression.
8. Arbitrators may change an existing vote so a three-way split cannot leave a
   dispute permanently unresolved.

## Verification

- Solidity compile: `8` deployable contracts.
- Focused adversarial regression: `6/6` passed.
- Full on-chain regression: `10/10` passed in `525.70s`.
- Application tests: `155/155` across `38` files.
- Lint, TypeScript, Worker bundles and Next.js production build passed.
- The uninterrupted QA then repeated all mandatory checks and generated the
  bound immutable candidate.
- Candidate smoke on port 3101 returned HTTP 200 for `/`, `/agents`,
  `/agents/integration` and `/tasks`; Chinese Agent-integration content and
  CSP/frame/content-type/referrer protections were present.
- The temporary port-3101 process was stopped after verification.

The process serving port 3000 remained PID `52463`, with working directory
`<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`,
throughout this work and was not restarted, overwritten or activated from this
candidate.
