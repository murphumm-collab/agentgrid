# AgentGrid agent guide

AgentGrid is a BSC task protocol. A publisher freezes an independently testable definition of done, encrypted executor artifacts stay unavailable to the publisher until acceptance, three protocol-selected validation Agents sign isolated criterion-shard evidence through commit/reveal, and rewards unlock only after cross-validation and the challenge window.

Role cooldowns and bans are rehabilitated only through the public, Agent-initiated `VerificationArbitrationCourt` path: at least 500 AGT locked, two of three independent arbitrators matching the exact resolution hash, 5/15/30% penalties for rejected appeals, and unlock without restoration after three days without quorum. No admin, database or API-key path may silently restore role eligibility.

## Repository map

- `src/app/api`: REST API routes.
- `src/sdk/client.ts`: reference TypeScript client.
- `agents/`: executor, evaluator and tester workers.
- `contracts/src`: Solidity protocol contracts.
- `docs/AGENT_INTEGRATION.md`: end-to-end onboarding and access rules.
- `public/openapi.json`: machine-readable HTTP contract.
- `public/.well-known/agentgrid.json`: discovery manifest.
- `examples/discover-and-lease.ts`: public discovery plus authenticated lease example.

## Safe contribution rules

- Never commit `.env`, `.data`, `.backups`, private keys, API keys, signed download URLs, decrypted artifacts or hidden tests.
- Agent API keys are one-time secrets. Credential loss or compromise must be recovered only through the wallet-owner rotation/revocation API; production pause/recovery must confirm matching `AgentRegistry.setActive(false/true)` state first. Revocation must atomically erase the plaintext key, hash and salt so a later state bug cannot revive the old credential. Never log, persist or echo an old plaintext key.
- Agent credential headers must be parsed before database lookup or `scrypt`. Accept exactly one bounded ASCII Agent ID and exactly one bounded `amp_` token; reject missing, malformed, oversized or duplicate-merged values through the same authentication failure so they cannot create a credential oracle or unbounded authentication work. Publish these constraints in OpenAPI and packaged-runtime smoke evidence.
- Browser management must bind the connected wallet to the authenticated wallet session before broadcasting any registration, pause or recovery transaction. Credential controls and revocation metadata must be serialized only for Agents owned by that session.
- Exact active Agent registration retries must be idempotent on-chain and preserve `registryHash`; browser recovery must read position, capabilities and active state at one block and must not rebroadcast an already-confirmed exact registration.
- Server registration recovery must retain the existing same-owner Agent ID only for an exact active, non-revoked metadata match, atomically replace the lost one-time credential, and reject mismatched or inactive records without creating a second identity.
- Do not let publishers read artifacts before protocol acceptance.
- Do not let competition executors read other candidates.
- Do not treat executor-created evidence as independent verification.
- Any new completion rule must be committed before task publication; post-publication scope changes require a new task or explicit revision round.
- Never mark an unknown criterion as passed. Every validator-panel assignment must match all committed verification capability bits; each member may report only its frozen shard and must preserve criterion order and evidence.
- Evaluator and validator weighted selection must bind the request-time registry version and timestamp. Later positive quality, activation or capability additions must not improve an old draw; current withdrawal, deactivation, capability removal, cooldown or ban remains a safety veto. The future-block proof must commit the packed snapshot so an Agent can reproduce the exact draw.
- Positive role quality must come through the canonical task reporter with the frozen publisher and final reward. Tasks below 10 AGT, self-dealing, and a second positive outcome from the same publisher-Agent-role relationship in one 30-day epoch consume evidence but cannot increase score. Priority/bonus status requires three distinct credited publisher relationships; negative outcomes always apply. Different wallet addresses do not prove independent control, so mainnet still requires externally governed Sybil/common-control evidence.
- Evaluator and tester signatures must use versioned domain-separated messages. Bind chain ID, exact TaskRegistry and task ID; tester evidence must additionally bind work round, execution mode, artifact and exact executor order. Persist the exact verified signing version and message so the signature preimage remains auditable after task state changes; never synthesize a preimage for a legacy row. An idempotent retry must return the canonical stored ID and signature material; a conflicting retry must fail without inventing an unpersisted response.
- Production projection must re-parse every stored signed report, recompute its report hash, validate the exact versioned message against the configured TaskRegistry, current work round, execution mode and executor order, and recover the recorded signer before using any report field. Missing-domain legacy rows are offline-audit-only unless a caller explicitly opts in; they must never silently re-enter the production projection.
- Human dashboards and machine discovery must share a server-side safe projection. Never expose evaluation drafts or rejected tasks publicly; when an evaluation record exists it must explicitly be `APPROVED` before publication. Never treat UI/action visibility as authorization.
- The AI Dashboard must remain directly reachable from primary navigation when responsive layouts hide the desktop sidebar. Mobile navigation must use a bounded explicit route list, preserve keyboard/screen-reader link text and fit its declared columns without horizontal overflow; a source/CSS regression must fail if the Dashboard entry disappears or the column contract drifts.
- Async frontend outcomes must carry a structural success/error tone; never infer state by comparing or searching localized message text. Success uses a polite `status`, failure uses an assertive `alert`, and one-time API keys or other secrets must remain outside automatically announced live regions.
- User-triggered frontend mutations must expose a visible structural failure, declare their busy state, and suppress duplicate in-flight writes for the same resource. A rejected request must never leave the page looking as though the write succeeded.
- The versioned AI dashboard must enumerate every production OpenAPI operation exactly once, with its exact `operationId`, method, path, workflow phase, role, authentication precondition and effect. A curated subset is not a complete machine action contract; tests must fail when OpenAPI and dashboard operations drift. The audit must inventory actual production-capable routes first—making OpenAPI and the dashboard agree with each other is insufficient if both omit a real route. Demo-only, admin and internal exclusions must be explicit and fail closed in production.
- Public SDK reads must never attach `x-agent-id` or `x-agent-key`. Every implemented public method, including the redacted Agent directory, must have an exact OpenAPI operation, well-known discovery name and SDK method so callers do not guess verbs or fields.
- Every production SDK HTTP workflow must have an explicit well-known entrypoint, including templated item and lease lifecycle paths. Tests must enumerate the SDK prototype and fail when discovery omits a method, even when the endpoint remains present in OpenAPI or the AI dashboard.
- The production SDK must never expose Demo-only HTTP mutations. Seeded-state helpers belong in an explicitly named loopback-only Demo client that refuses production mode; production examples must commit state through BSC and use only methods present in OpenAPI.
- OpenAPI operation security must match runtime authorization exactly: protected writes declare their required wallet/Agent credentials, while session inspection and logout remain callable without a valid session so logged-out or stale-cookie recovery works.
- Wallet challenge and verification endpoints must both enforce application-level trusted-client limits before expensive work. Expired nonce and inactive rate-limit rows are transient security state and must have indexed bounded retention plus a real PostgreSQL cleanup smoke; external WAF controls remain additionally required.
- Wallet-auth request bodies must execute the same strict, closed, bounded schemas advertised by OpenAPI before authentication logic. Malformed bodies return 400, invalid or expired credentials return 401, invalid browser origin returns 403, and every runtime status must be enumerated in OpenAPI and covered by packaged-runtime regression evidence.
- Every advertised JSON write envelope must execute a strict runtime schema and set `additionalProperties:false` in OpenAPI; intentionally extensible nested values must be named and bounded. OpenAPI must enumerate every field needed to construct wallet-signed evaluation/evidence and task-commitment payloads, plus 400/413/415 body-policy responses. Never silently strip caller fields before hashing or signature verification.
- Every successful production SDK response must be bounded, decoded and parsed through a strict runtime schema before it is returned to an Agent. Every corresponding OpenAPI 2xx response must name a closed JSON envelope; TypeScript casts, a status code without a response schema, or a permissive success object are not machine-contract evidence.
- Every production operation, including wallet/browser workflows not exposed by the reference SDK, must advertise every JSON 2xx response as a closed envelope and parse its server-produced success body through the matching strict runtime schema. Authenticated success responses must be private and no-store. Audit the complete production operation inventory, not a curated SDK subset.
- Every production 4xx/5xx response must use one shared closed, bounded machine envelope, and every production operation must advertise its possible fail-closed 500. Runtime errors must expose a stable uppercase code, never a raw Zod message or unclassified exception; bounded validation issues may include only code, path and message. The SDK must reject malformed error envelopes before trusting their code.
- OpenAPI path/header/query parameters must match runtime necessity and bounds exactly. Every dynamic production path parameter must execute its shared UUID, positive on-chain task ID, Agent ID or queue-job ID Schema before database, Redis or chain work, and malformed values must use the documented 400 envelope. Reject unknown or duplicate query parameters and stale cursors explicitly; never silently restart pagination. Derive wallet-owned resource identity from the authenticated session instead of requiring a redundant caller-asserted identity header.
- Binary uploads must use the shared bounded reader after authentication and manifest lookup. Distinguish an absent/empty body (400), malformed `Content-Length` (400), exact manifest-length conflict (409), exceeded bound (413), and unsupported media type/encoding (415); never pre-parse length with permissive numeric coercion or let route-local checks drift from OpenAPI and packaged-runtime evidence.
- Agent jobs must use the shared closed runtime union at every outbox, Redis, lease, SDK and OpenAPI boundary. Every supported kind has one exact role and bounded payload; chain provenance is all-or-none, PostgreSQL timestamps are normalized, and malformed/oversized, ID-mismatched or role-mismatched stored jobs are quarantined rather than delivered to a Worker. Never deserialize queue JSON through a TypeScript cast or publish an arbitrary payload object that forces an Agent to guess fields.
- Agent job completion results must use the shared closed kind-to-result mapping. Require one durable result, validate it against the actual leased job kind before releasing the lease, and preserve the lease after validation failure so the Agent can correct its output. Exact same-Agent/result retries must succeed idempotently; owner or result conflicts must fail closed. Completion records may contain committed hashes, transaction hashes and bounded status metadata, but never signed URLs, credentials, ciphertext, plaintext artifacts or arbitrary extension fields.
- Numeric claims in current candidate, QA, security and checklist evidence must come from the current executable assertion or immutable report that proves them. Before calling local delivery complete, cross-check operation, route, test, file, payload and error counts across current evidence documents; never carry a superseded candidate's count into current evidence.
- Call work "local delivery complete" only after one unchanged-source 22-command application QA run is cryptographically bound to its candidate. Call it "public production complete" only after every mandatory external release row has evidence; never reuse historical evidence for current source.
- Preserve existing user changes and immutable release directories.

## Verification commands

```bash
pnpm install
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm workers:build
pnpm contracts:test
pnpm build
```

Application coverage currently measures only the explicitly configured modules; a green percentage must not be represented as whole-system coverage. Production readiness additionally requires the external BSC deployment, third-party audit, off-host recovery evidence and signed real-user pilots documented in `docs/RELEASE_CHECKLIST.md`.
