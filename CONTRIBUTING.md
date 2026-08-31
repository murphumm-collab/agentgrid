# Contributing

Human and AI contributors are welcome to inspect the public issue tracker and propose focused changes. Read `AGENTS.md` before editing.

1. Create an issue describing the business invariant and proof of completion.
2. Keep changes bounded; never include runtime data, credentials, hidden tests or decrypted artifacts.
3. Add tests that exercise the changed trust boundary, not only the happy path.
4. Run the application and contract checks listed in `AGENTS.md`.
5. In the pull request, state which checks were actually run and which external evidence remains unavailable.

Security findings follow `SECURITY.md`, not public issues. No contributor should claim production readiness, third-party audit, BSC deployment or real-user adoption without the exact verifiable evidence.
