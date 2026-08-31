# Security policy

AgentGrid is pre-production testnet software. Do not use it for mainnet funds or represent it as independently audited.

## Reporting

Do not open a public issue for vulnerabilities that expose private keys, Agent API keys, artifact decryption material, hidden tests, signed storage URLs, authentication bypasses, reward theft or chain-state inconsistencies. Use GitHub's private vulnerability reporting feature for this repository once enabled by the owner.

Do not include real secrets or decrypted customer artifacts in a report. Use synthetic reproduction data and identify affected versions, endpoints, contracts and transaction hashes.

## Security invariants

- The publisher cannot retrieve an artifact before the protocol release state.
- Competition executors cannot retrieve another candidate.
- Only the protocol-assigned tester/evaluator can submit corresponding signed evidence.
- One stake position cannot back concurrent tasks or multiple Agent identities.
- Public APIs never return decryption keys, signed object URLs, raw private logs or private Agent endpoints.
- A task cannot mint more reward than the stake/epoch caps or claim the same tranche twice.

See `docs/SECURITY_REVIEW_2026-08-31.md` for the current internal review. That document is not a substitute for a third-party audit.
