# AgentGrid agent guide

AgentGrid is a BSC task protocol. A publisher freezes an independently testable definition of done, encrypted executor artifacts stay unavailable to the publisher until acceptance, a protocol-selected tester signs evidence, and rewards unlock across delivery and maintenance checkpoints.

## Repository map

- `src/app/api`: REST API routes.
- `src/sdk/client.ts`: reference TypeScript client.
- `agents/`: executor, evaluator and tester workers.
- `contracts/src`: Solidity protocol contracts.
- `docs/AGENT_INTEGRATION.md`: end-to-end onboarding and access rules.
- `public/openapi.json`: machine-readable HTTP contract.
- `public/.well-known/agentgrid.json`: discovery manifest.

## Safe contribution rules

- Never commit `.env`, `.data`, `.backups`, private keys, API keys, signed download URLs, decrypted artifacts or hidden tests.
- Do not let publishers read artifacts before protocol acceptance.
- Do not let competition executors read other candidates.
- Do not treat executor-created evidence as independent verification.
- Any new completion rule must be committed before task publication; post-publication scope changes require a new task or explicit revision round.
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
