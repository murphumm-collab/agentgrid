# AgentGrid historical local QA/candidate evidence — 2026-09-02

This evidence binds the governed source frozen at commit `1764c30`. It became
historical when the next governed development cycle added paid-capacity source.
The candidate passed its complete local QA and is immutable, but the broader
product scope is not yet locally complete; it is not activated or publicly
deployed.

## Candidate identity

- Build ID: `nShHeijb9O7TsJrsHaT6w`
- Candidate directory:
  `/Users/mac/Documents/ChatGPT/AtoA产品开发/local-releases/agentgrid-20260901T235006Z-nShHeijb`
- Source SHA-256:
  `sha256:8ace26d6ab52599262ca006102bc3873656d2ed8b694bb4b44360ad62edf0fae`
- `server.js` SHA-256:
  `82adb99683348f2e8a036d12e953fd5b011a4925125e2487d318e2ab5337f0ae`
- Payload SHA-256:
  `sha256:6a250db154efa2c427cefbae4eca5b49e070c09eab8fd5f6823bd10ce73d2e57`
- Payload size: 2,582 entries / 69,617,131 bytes
- Release manifest SHA-256:
  `sha256:04515d6ccf598efe412fc021350e83fa4818b89b072a04e2a7cc568b054da7b2`
- Flags: `payloadReadOnly:true`, `immutableSnapshot:true`,
  `activationRequired:true`
- Activation status: **not activated**

## Fixed application QA

One uninterrupted `pnpm release:qa:run` passed all 22 fixed commands from
`2026-09-01T23:27:12.427Z` through `2026-09-01T23:50:09.040Z`. It covered the
complete application/dependency suite, typecheck, lint, eleven-contract compile,
31/31 contract regression, all Worker bundles, production Compose and Web build,
file-secret policy, PostgreSQL, Redis queue, encrypted artifact, constrained
sandbox, artifact-key rotation, reorg recovery, packaged Agent delivery,
monitoring drill, trusted proxy, KMS custody, database backup/restore and the
candidate snapshot.

The mode-0600 report is:

`/Users/mac/.agentgrid-release-evidence/agentgrid-qa-1764c30/application-qa.json`

Its file SHA-256 is
`ac82497565dc97584cc7d5207560d69cb8e449add641bd98102fd22935d94d80`.

## Independent recheck

- The strict report verifier accepted the exact ordered 22-command set and all
  exit codes are zero.
- A separate source-tree walk recomputed the report SHA-256 across 350 governed
  source entries.
- The candidate verifier independently recomputed 2,582 payload entries,
  69,617,131 bytes and the exact payload digest.
- Independent byte hashing reproduced the manifest and `server.js` digests.
- The candidate contains 2,481 files, 774 directories and 102 safe relative
  links. The root is mode 0555, the manifest is mode 0444 and the verifier
  accepts only the declared owner-only `.next/cache` mutable path.

## Honest release status

This closed the QA/candidate binding for source `1764c30`, not the repository's
broader local-delivery gate. Paid extra competition slots and paid scheduling
capacity remain local product gaps; current source changes already make this
evidence historical. GitHub push, BSC Testnet
funding/deployment, public hosting, production secrets/KMS, off-site recovery,
real independently controlled participants, external audits and accountable
signatures remain mandatory external gates in `docs/EXTERNAL_COLLABORATION.md`.
