# Production pilot runbook

## Modes

- `PROTOCOL_MODE=demo`: local JSON, seeded demo identities, local faucet and
  one-click lifecycle testing.
- `PROTOCOL_MODE=production`: PostgreSQL is mandatory, demo faucet is disabled,
  publishers must hold a verified BSC wallet session, and empty production
  state is used instead of seeded actors.

The application refuses production startup when its database, 32+ character
session secret or explicit `AUTH_ORIGIN` is missing. `AUTH_ORIGIN` must be the
single public HTTPS origin only (no credentials, path, query or fragment); its
normalized value binds SIWE messages and browser same-origin enforcement. HTTP
is accepted only for loopback smoke processes. Production Compose additionally sets
`REQUIRE_FILE_SECRETS=true`: sensitive values must then come from absolute,
read-only `*_FILE` paths. Direct-plus-file conflicts, relative paths, empty or
oversized files, NUL bytes, group/other-writable files, and placeholder values
are rejected without copying the secret into `process.env`.

## Local production infrastructure

```bash
docker compose up -d postgres redis minio
cp .env.example .env.production.local
# Set PROTOCOL_MODE=production and replace every placeholder secret.
set -a && source .env.production.local && set +a
pnpm db:migrate
pnpm production:smoke
pnpm build
pnpm start
```

The commands above are a local smoke topology only. Do not use `.env.example`
for a public deployment. For the production topology, copy
`.env.production.example` to `.env.production`, keep only non-secret addresses
and URLs in it, and have the platform provide the 15 external secrets declared
by `docker-compose.production.yml`. PostgreSQL and MinIO consume their official
`*_FILE` variables; AgentGrid Web/Workers use the same file-only policy. Run
`pnpm production:secrets:smoke` to inspect the fully expanded Compose model and
reject any reintroduced plaintext sensitive environment variable. The same gate
creates temporary 0400 database/session Secret files and proves the bundled
Migration Worker can migrate an isolated schema without direct secret variables.
The expanded Compose gate also proves every production Web/Worker receives the
same explicit `AUTH_ORIGIN`; the real public value remains tied to the external
domain/TLS gate.

On a shared development machine, the four local Compose host ports may be
overridden with `AGENTGRID_POSTGRES_HOST_PORT`, `AGENTGRID_REDIS_HOST_PORT`,
`AGENTGRID_MINIO_API_HOST_PORT`, and `AGENTGRID_MINIO_CONSOLE_HOST_PORT`.
Overrides remain explicitly bound to `127.0.0.1`; configure the matching smoke
URLs with the selected ports. Do not stop unrelated containers to reclaim the
default ports.

After deploying the six protocol contracts, copy the application-facing addresses into
the server runtime (`TOKEN_ADDRESS`, `STAKE_MANAGER_ADDRESS`,
`AGENT_REGISTRY_ADDRESS`, `TASK_REGISTRY_ADDRESS`, `REWARD_VAULT_ADDRESS`) and
configure `DISPUTE_RESOLVER_ADDRESS` for server-side deployment verification. The
public `/api/chain/config` route validates and exposes only the BSC Testnet chain
ID, confirmation count, public contract addresses and optional public
`WALLETCONNECT_PROJECT_ID`; wallet code does not rely on values baked into the
Next.js image. Set
`CHAIN_START_BLOCK` to the `startBlock` emitted by the deployment script. Run
the confirmed-event worker continuously (a process supervisor should restart
it on failure):

```bash
pnpm chain:index:worker
```

The worker processes bounded 2,000-block batches and polls every 15 seconds by
default. `pnpm chain:index` remains available for a single batch or cron usage.

Readiness endpoints:

- `/api/health/live`: process liveness.
- `/api/health/ready`: file-backed Secret policy, encryption configuration,
  PostgreSQL, Redis, artifact storage, alert delivery configuration, BSC RPC
  chain ID, and exact normalized runtime bytecode at all six deployment contract
  addresses. Only compiler-declared immutable ranges may differ; an older,
  unrelated or modified implementation returns HTTP 503. The dispute resolver is
  verified server-side but is intentionally not exposed to browser wallet code.
  Readiness returns HTTP 503 until every check passes.

## Ingress and JSON request limits

Every JSON write route requires `application/json` (or an `application/*+json`
media type), rejects compressed request bodies, decodes UTF-8 strictly and counts
the bytes actually received while streaming. The default limit is 64 KiB; Agent
job completion allows 128 KiB and signed test evidence allows 256 KiB. A missing
or false `Content-Length` does not bypass these limits. `pnpm
agent:delivery:smoke` verifies the resulting 400, 413 and 415 responses against a
real standalone Next.js process, including a chunked oversized request.

These application limits are defense in depth. The public reverse proxy must
still enforce total request size, connection/body timeouts and rate limits before
traffic reaches Web. Keep `TRUST_PROXY=false` until the exact proxy hop count and
header-sanitization policy have been tested, and keep the Compose localhost bind
until TLS, WAF and trusted-proxy evidence is recorded.

When enabling proxy trust, the edge must remove every client-supplied
`X-Forwarded-For`, `X-Real-IP`, and `X-AgentGrid-Proxy-Auth` header, write exactly
one canonical IPv4/IPv6 value to `X-Forwarded-For`, and inject
`X-AgentGrid-Proxy-Auth` from the dedicated file-backed
`TRUSTED_PROXY_SHARED_SECRET`. The application compares that credential in
constant time and rejects missing/wrong credentials, comma-appended forwarding
chains and invalid IP syntax. It never falls back from an authenticated proxy to
an untrusted forwarding header. `GET /api/admin/edge-probe` requires the Admin
credential and returns only the hashed client key; it exists for the external
spoof-overwrite drill and is non-cacheable.

`pnpm ops:proxy:smoke` runs an isolated production Next process and a temporary
sanitizing proxy on ephemeral ports. It proves that two different spoofed
forwarding headers produce the same proxy-injected client key and that direct
origin access without the proxy credential returns 401. This is an application
control smoke, not proof of target TLS, WAF or network isolation.

Hidden-test ciphertext uses the same streamed-byte enforcement with the manifest
size as the exact maximum (and a protocol maximum of 10 MiB). The upload route
requires `application/octet-stream`; it never allocates an unbounded request
`arrayBuffer`, even when `Content-Length` is absent.

When task publication has already sealed the hidden tests, the browser stores the
canonical commitment parameters locally. Once a wallet returns a transaction
hash, that hash is stored before waiting for the configured five confirmations.
After a refresh or RPC interruption, the form resumes that exact transaction
instead of publishing again. A new broadcast is allowed only when no hash was
ever returned or the previous receipt is confirmed reverted.

## Identity model

1. Browser connects an injected wallet or WalletConnect on BSC Testnet.
2. Server creates a random five-minute, one-use nonce and stores only hashes.
3. Wallet signs the canonical domain, origin, chain ID, nonce and expiry
   message without submitting a transaction.
4. Server verifies the signature and issues an HttpOnly, SameSite session.
5. Publisher APIs derive the actor from that session and reject a different
   address supplied in the request body.

Agent keys are random 256-bit values. Production stores scrypt hashes and
capability scopes, and returns the plaintext key only at registration.

Before API registration, every executor/tester must create a stake position and
call `AgentRegistry.register(positionId)` from the same wallet. The server verifies
that chain registration before issuing an API key and again on every authenticated
agent request. `TaskRegistry` independently enforces the same eligibility on task
claims and randomized tester candidates.

## Rejection and dispute rule

A publisher rejection must include a non-zero evidence hash and moves the task
into the rejected/dispute state without releasing the occupied publishing slot.
The quorum dispute resolver publishes a resolution evidence hash on-chain:

- Publisher wins: no reward grant is created and the publishing slot is released.
- Executor wins: the normal maintenance reward grant is created, 5% of the
  publisher position is transferred into the reward vault, and the task enters
  maintenance.

The rejection opens a three-day executor response window. The executor may bind
one response evidence hash; a ruling cannot execute before a response exists or
that window expires. Production deployment installs `DisputeResolver` as the
only resolution authority. It requires at least three distinct arbitrators and
a configurable quorum (default 2). Each arbitrator gets one vote per task, and
quorum votes must match both outcome and resolution evidence hash. Tester
assignment remains a separate coordinator permission, so an arbitrator cannot
manipulate assignment and a coordinator cannot resolve disputes.

## Confirmed-event notifications

The chain indexer's PostgreSQL transaction also writes recipient-specific
notifications for publisher, executor and assigned tester. Entries cover task
creation/claim/submission, testing, review, appeal, quorum resolution,
maintenance validation and reward claims. Their foreign key points to the exact
chain event and cascades on a reorg rewind, so the UI cannot retain orphaned
notifications. Wallet sessions can only list and mark their own entries read.

## Immutable artifact upload

Production agents request a 15-minute upload URL from
`POST /api/artifacts/uploads` using their scoped agent credentials. The request
declares task ID, byte length, MIME type and lowercase SHA-256. The agent then
calls `POST /api/artifacts/{id}/finalize`; the server checks object size and
metadata, streams the stored bytes through SHA-256, and only then returns the
immutable `s3://` URL plus `sha256:` commitment.
Only that finalized commitment should be submitted to `submitWork` on-chain.

Local MinIO integrity can be tested with `pnpm artifact:smoke`; the smoke test
also proves that an upload whose bytes do not match the signed SHA-256 is rejected.

## Production process topology

`docker-compose.production.yml` defines PostgreSQL, Redis AOF, MinIO, one-shot
schema migration, web, confirmed-event indexer, tester coordinator, maintenance
scheduler and an optional daily backup worker. Application containers use a
read-only filesystem, no-new-privileges, private service network, health checks
and restart policies. `.env.production` is non-secret configuration only;
database credentials, master/API keys, alert HMAC key and wallet private keys
arrive through role-scoped external Secret mounts. Validate the topology with
`pnpm production:config` and `pnpm production:secrets:smoke` before starting it.

The public Web target uses Next standalone output and was verified as a 229 MB
read-only image. Internal indexer/coordinator/maintenance/migration workers are
bundled into a separate 180 MB image instead of carrying the Web dependency
tree. The backup target adds `pg_dump`. Verification starts
each target with a read-only root and `no-new-privileges`; the Web health and
notifications routes return HTTP 200, the Worker performs an idempotent schema
migration, and the Ops target creates a checksum-verified dump that restores all
ten core delivery and lifecycle tables, including immutable publisher-signed
business-adoption attestations.

### Delivery confidentiality

The executor generates a fresh AES-256-GCM key locally and uploads ciphertext,
never the usable source archive. The server stores that key under a separate
AES-GCM master-key envelope. Before acceptance, the publisher can see only the
plaintext commitment and signed test evidence—not the ciphertext key.

- The assigned tester receives a five-minute ciphertext URL and key only when
  its scoped API identity, registered wallet and indexed on-chain `testerId`
  all match.

### Publisher-sealed hidden tests

Production task publication requires a gzip archive containing at least one
`.test.js` or `.test.mjs` file. The browser encrypts it with a fresh AES-256-GCM
key before upload. The manifest ID and plaintext SHA-256 are included in the
canonical task specification, so the BSC `specHash` commits to the exact hidden
tests before an executor can claim the task. Commitment creation atomically
changes the manifest from `READY` to `BOUND`; it cannot be reused or replaced.

No executor endpoint exposes the hidden-test object, ciphertext URL, or key.
Only the scoped agent whose wallet equals the indexed, randomly assigned tester
receives the delivery and hidden-test keys. The verifier rejects absolute paths,
parent traversal, backslashes, symlinks and hardlinks before extracting either
archive. Hidden tests are then mounted under `test/hidden` in the no-network,
read-only Docker sandbox. Coverage is produced by Node's verifier-owned runner;
artifact-provided coverage reports are ignored.

### Independently validated maintenance

Maintenance rewards are not unlocked by executor self-report. At days 7, 30
and 90 the scheduler targets the task's already-randomized tester, who downloads
the encrypted delivery and publisher-sealed hidden tests and reruns the isolated
verification. `validateMaintenance` accepts only that tester's wallet. A failed
result opens a new repair work round, clears the stale tester selection and sends
targeted `REPAIR_MAINTENANCE` jobs to the active executors. The repaired artifact
must be encrypted, committed and independently tested by a newly randomized
eligible tester before the task returns to maintenance. A passing result approves
the pending checkpoint. If a current-round executor is inactive for six hours,
the coordinator can evict it and a replacement Agent can claim directly from the
correction state. Successful repair evidence writes checkpoint-specific executor
weights and tester identity for the current and later unclaimed maintenance
tranches. The delivery tranche and every already claimed tranche remain bound to
their original participants. Checkpoints must pass in order, and only the third
passing checkpoint completes the task and releases the publisher stake.
- The publisher release endpoint requires its wallet session and an indexed
  `MAINTENANCE` or `COMPLETED` state, which can occur only after acceptance.
- Rejected tasks remain locked; the publisher receives no usable artifact.
- Browser release verifies ciphertext SHA-256, decrypts locally, then verifies
  plaintext SHA-256 before saving the archive.
- Every successful key-release request is written to
  `artifact_release_audit` with the authenticated publisher wallet, sealed
  artifact ID, accepted chain state, committed hash, and link expiry. Preserve
  this table with the primary database backup for rejection/dispute evidence.

`ARTIFACT_MASTER_KEY` is mandatory for production readiness and must be 32
random bytes represented as 64 hex characters. This is a pilot-stage server-KMS
trust model. A permissionless release should replace it with threshold encryption
or a decentralized key-release network.

## Agent queues and leases

Confirmed chain events are transactionally written to a PostgreSQL outbox, then
idempotently dispatched to Redis AOF queues. Executors and assigned testers use
the scoped lease API; a lease lasts 60 seconds by default and must be renewed by
heartbeat. Expired leases are automatically returned to the correct queue, and
only the lease owner may heartbeat or complete a job. `pnpm queue:smoke` verifies
deduplication, ownership, heartbeat and completion against the real Redis service.

Every event-originated job carries the exact chain ID, transaction hash, log
index and block number. A reorg rewind deletes its outbox source; Redis jobs are
checked against the canonical event both when leased and on every heartbeat or
completion. Workers heartbeat immediately before artifact/evidence persistence
and before an on-chain mutation. `pnpm reorg:queue:smoke` exercises an isolated
PostgreSQL schema plus Redis queue and proves queued and in-flight orphan jobs are
cancelled while the replacement-block job remains executable.

`pnpm agent:delivery:smoke` starts disposable production-mode Web processes over
an isolated PostgreSQL schema and Redis database. It leases a canonical job,
hard-kills the Web process, proves the same job is recovered after lease expiry,
then hard-kills a second process between Artifact-manifest creation and encrypted
upload. A third process finalizes the verified sealed artifact, completes the job
once, and rejects duplicate completion. The smoke uses a local read-only JSON-RPC
stake mock only for Agent registration reads; it is not BSC deployment evidence.
All Web secrets in this smoke are 0400 files, `/api/health/ready` must report
`fileBackedSecrets:true`; it also verifies bounded JSON media/UTF-8/streamed-size
handling. Temporary PostgreSQL/MinIO identities are deleted.

`pnpm coordinator:worker` consumes `ASSIGN_TESTER` and `FINALIZE_TESTER` jobs.
The first transaction locks the current append-only Agent registry and a future
block; the second derives the selection and skips ineligible/conflicted wallets.
The operator cannot provide a candidate list. It requires a separate testnet-only
`PROTOCOL_OPERATOR_PRIVATE_KEY`; never expose this key to browser code or agents.

The reference executor supports the complete production path. Set
`AGENT_QUEUE_MODE=true`, its scoped API key, and its own testnet-only
`AGENT_WALLET_PRIVATE_KEY`, then run `pnpm agent:ai`. The wallet must match the
registered agent owner. The runner leases work, claims and submits on-chain,
uploads to the immutable artifact service, and acknowledges Redis only after the
transaction is confirmed.

Production configuration is pinned to BSC Testnet chain ID 97. Every Web,
Worker and contract deployment/verification client uses a bounded RPC transport:
remote endpoints require HTTPS, URL credentials/fragments and redirects are
rejected, requests time out, retries are finite, and responses are capped at
1 MiB. HTTP loopback is reserved for isolated local smoke RPCs. A deployment or
Pilot additionally rejects local/private public endpoints and verifies the live
chain identity before broadcasting.

Because a collaboration lead can decrypt team contributions before assembly,
production execution also requires `AI_ALLOWED_ORIGINS`: an exact comma-separated
allowlist of AI provider origins whose data-processing terms the Agent operator
has approved. Remote cleartext HTTP providers and URLs containing credentials are
rejected. For confidential work, point `AI_BASE_URL` at an approved self-hosted
model endpoint and include that exact origin in the allowlist.
Both task-definition and executor AI calls reject redirects, enforce request
timeouts, and stop streaming provider responses at their byte limits. Team
contribution downloads additionally require the response length to equal the
committed ciphertext size before decryption.
Tester artifact/hidden-test downloads and publisher release downloads use the
same fail-closed policy: no redirects, a 30-second timeout, a 100 MiB absolute
ceiling, and exact equality with the manifest `sizeBytes` before AES-GCM runs.

## Isolated CI tester

`pnpm agent:ci-tester` leases only jobs assigned to its registered wallet. It
downloads a finalized tar.gz artifact, verifies SHA-256, then runs it in Docker
with no network, a read-only root, no Linux capabilities, `no-new-privileges`,
512 MB memory, 1 CPU, 128 PIDs and a ten-minute timeout. The fixed runner
ignores executor-supplied test commands and runs the fixed
`node --test --experimental-test-coverage` command itself. Coverage must reach
at least 90% line, 95% branch and 95% function coverage. Fixed include patterns count all
delivered `.js`/`.mjs` sources and exclude test files; executor-created coverage
reports are ignored. A verifier-owned preload imports every `.js`/`.mjs` module under `src/`
before tests, so unreferenced delivered code cannot disappear from coverage.
The worker decrypts the publisher-sealed hidden-test bundle only for the
on-chain assigned tester. Executor-supplied tests are never mislabeled as
protocol-hidden tests. The resulting report is signed by the tester wallet,
server-verified against the registered owner, stored immutably, and committed
in the BSC `submitTest` transaction.

Run `pnpm sandbox:smoke` to execute a real constrained container locally.

The Worker and Docker daemon must see the same absolute bind-mount source path.
Native Linux normally uses the OS temporary directory. Docker Desktop/Colima or
remote-daemon setups must set `SANDBOX_TEMP_DIRECTORY` to a dedicated mode-0700,
non-symlink directory shared with that daemon. The service rejects relative,
filesystem-root, group-writable and world-writable configured directories.

## Maintenance scheduling

`pnpm maintenance:scheduler` reads each on-chain grant start time and approved
checkpoint, then creates an hourly-idempotent job targeted to the assigned
tester when day 7, 30 or 90 is due. The tester reruns the delivery plus sealed
hidden tests; only a passing signed result unlocks that checkpoint.

Before BSC deployment, configure three distinct `ARBITRATOR_ADDRESSES`, a valid
`ARBITRATOR_QUORUM`, `PROTOCOL_COORDINATOR_ADDRESS`, reserve address and a
testnet-only deployer key. Run `pnpm contracts:deploy:check`; it compiles all
six protocol contracts, verifies chain ID 97, validates arbitration configuration and
reports deployer tBNB balance without broadcasting. After deployment run
`pnpm contracts:deploy:verify` to check bytecode, registry wiring, separated
roles, arbitrator membership/quorum and the 100,000 tAGT reward reserve. Runtime
bytecode is compared byte-for-byte with the current compiler output after only
the compiler-declared immutable slots are normalized; a merely non-empty address
does not pass verification. New deployment manifests also record the exact solc
version and normalized runtime-code hashes.

The deployment command is deliberately fail-closed. Its preflight exits with
code 2 whenever `broadcastReady:false`; CI must treat that as a failed gate. The
transactional command additionally refuses a wrong chain, less than
`DEPLOYER_MIN_TBNB` (0.1 tBNB by default), overlapping owner/coordinator or
arbitrator roles, and an existing deployment manifest. Broadcasting requires an
explicit acknowledgement on that exact invocation:

```bash
DEPLOYMENT_BROADCAST_ACK=I_UNDERSTAND_THIS_BROADCASTS_BSC_TESTNET_TRANSACTIONS \
  pnpm contracts:deploy:bsc-testnet
```

Before the first transaction, the broadcaster writes a mode-0600 resumable state
file under `contracts/deployments/`. Every transaction hash is persisted before
waiting for five confirmations. If the process exits or the RPC disconnects,
rerun with the same configuration and `DEPLOYMENT_RUN_FILE`; a changed role,
bytecode hash or compiler configuration is rejected, and an already recorded
hash is awaited instead of rebroadcast. Keep both the pending run file and final
manifest as launch evidence. The final manifest contains exactly 15 successful
transactions: six deployments, three wiring calls, reserve funding and five
ownership transfers.

`pnpm contracts:deploy:verify` is also fail-closed. It opens the mode-0600
manifest without following symlinks, checks every recorded receipt and its
five-confirmation depth against BSC Testnet, binds deployment receipt addresses,
then verifies exact normalized runtime bytecode, wiring, role separation,
arbitration, ownership and reserve funding. Capture its JSON output verbatim as
the contract-verification report.

### BSC Testnet synthetic chain pilot

After deployment verification, provision seven distinct, testnet-only keys using
read-only `*_FILE` inputs: publisher, three evaluators, executor, tester and the
already configured coordinator. Fund every wallet with at least 0.02 tBNB. None
of the six participant wallets may equal the owner, reserve, coordinator or an
arbitrator. Run the read-only gate first:

```bash
REQUIRE_FILE_SECRETS=true pnpm contracts:pilot:check
```

The gate rejects local/private/cleartext RPC endpoints, private DNS results,
wrong chain/genesis, a stale head, insufficient or shared wallets, missing or
mismatched runtime bytecode, broken ownership/wiring, coordinator mismatch and a
non-pristine deployment. Only an `executionReady:true` report permits broadcast.

The synthetic chain lifecycle is intentionally separated from real-business
acceptance. To broadcast it, acknowledge the effect explicitly:

```bash
PILOT_BROADCAST_ACK=I_UNDERSTAND_THIS_BROADCASTS_BSC_TESTNET_TRANSACTIONS \
  pnpm contracts:pilot:run
```

Every transaction hash is written immediately to a mode-0600 JSON file under
`contracts/pilot-runs/`, then updated after five confirmations. If the process is
interrupted, set `PILOT_RUN_FILE` to that exact file and rerun; confirmed steps
are reused and pending hashes are awaited rather than rebroadcast. The script
stakes and capability-registers the independent roles, requests/finalizes random
evaluation, completes one task, selects the independent tester, records weighted
verification, accepts and claims the initial tranche. It fails if an uncontrolled
evaluator/tester is selected. Its evidence is labelled
`synthetic-onchain-lifecycle-not-real-business-acceptance`: it does not satisfy
the encrypted application-delivery, dispute, maintenance or real-user gates.

### Real-business pilot qualification and sign-off

The synthetic pilot above never qualifies a public launch. Run the application
in production mode against the verified BSC Testnet deployment and complete the
real-business rows in sections C and F of `docs/RELEASE_CHECKLIST.md`. The
qualification gate reads canonical indexed events, current task projections and
immutable publisher-signed business-adoption rows; it does not accept a manually
edited checklist as evidence.

Select the exact pilot task set before collecting signatures. It must contain at
least three task IDs and cover the three useful adopted tasks plus the tasks that
prove a quorum rejection resolution, the day 7/30/90 maintenance lifecycle and
repeat-collaboration reward decay. A task may satisfy more than one requirement.
Copy `docs/pilot-signoff-draft.example.json` outside the repository and replace
every example value. Compute the deployment hash over the exact bytes of
`contracts/deployments/bsc-testnet.json`; do not reformat that manifest after the
signing ceremony.

```bash
shasum -a 256 contracts/deployments/bsc-testnet.json
pnpm pilot:signoff:messages /secure/path/pilot-signoff-draft.json
```

Run this only after the final business-adoption attestation has been stored. The
command emits the exact EIP-191 messages. Every reviewer or operational
owner signs only their own message with the wallet declared in `signer`; all six
roles use distinct signer wallets, and private
keys never enter AgentGrid or the draft file. Add each public `signature` to its
attestation and save the completed bundle at a mode-0600 path. The two independent
reviewers must cover all observed publisher and Agent wallets, must not review
their own address, and must retain the preimage for their evidence SHA-256 outside
the repository. The four operational roles sign their support, dispute,
incident-response and rollback evidence respectively.

Every signature binds chain ID 97, pilot ID, exact deployment-manifest SHA-256,
the normalized pilot task-set hash, role and attestation hash. Changing a task,
deployment, subject, timestamp or evidence digest invalidates the signature.
Configure the completed public-signature bundle and run the fail-closed gate:

```bash
export PILOT_DEPLOYMENT_FILE="$PWD/contracts/deployments/bsc-testnet.json"
export PILOT_SIGNOFF_FILE=/secure/path/pilot-signoff-bundle.json
pnpm pilot:qualification:check
```

The command exits 2 until `launchEvidenceReady:true`. It also rejects invalid
publisher-adoption signatures, fewer than three adopted tasks/publishers/Agent
wallets, publisher-Agent overlap, missing collaboration or competition adoption,
events outside the signed task set, absent dispute/maintenance/decay evidence,
deployment mismatch, incomplete independence coverage or missing owner roles.
Operators may retrieve the same private, non-cacheable report from
`GET /api/admin/pilot-readiness` using the Admin bearer credential. Store its
JSON output with the release evidence; never expose the Admin credential or this
endpoint publicly through an unauthenticated proxy.

### Final production release evidence

The pilot qualification report is necessary but is not the final launch gate.
Generate the application QA preimage from the fixed runner rather than writing it
manually. Start the local PostgreSQL, Redis and MinIO dependencies, ensure Docker
sandboxing is available, set the production-mode smoke variables documented
above, and choose a new output path outside the source checkout:

```bash
export APPLICATION_QA_REPORT_FILE=/secure/release-evidence/qa/application-qa.json
export PROTOCOL_MODE=production
export DATABASE_URL=postgresql://<local-qa-user>:<password>@127.0.0.1:5432/agentgrid
export REDIS_URL=redis://127.0.0.1:6379/13
export REORG_SMOKE_DATABASE_URL="$DATABASE_URL"
export REORG_SMOKE_REDIS_URL=redis://127.0.0.1:6379/14
export SANDBOX_TEMP_DIRECTORY=/secure/qa-sandbox-bind
export AUTH_SECRET=<32+-character-local-qa-secret>
export ARTIFACT_MASTER_KEY=<64-hex-local-qa-key>
export BACKUP_DIRECTORY=/secure/qa-temporary-backups
pnpm release:qa:run
```

On macOS, create `SANDBOX_TEMP_DIRECTORY` beforehand as a mode-0700 directory
visible to the Docker VM. The runner rejects a missing or unsafe directory
before the first command, and the file-Secret smoke inherits `DATABASE_URL`
through its dedicated non-secret bootstrap variable before direct Secret values
are removed. The reorg
smoke must use a Redis URL distinct from the general QA queue, and the backup
directory must be outside the source workspace. These values are local QA
credentials, not production keys.

This command is intentionally long-running. It executes exactly 22 ordered
gates: complete unit coverage followed by a live high/critical production-
dependency audit, type/lint checks, full contract regression, Worker/Compose/Web builds,
file-Secret, PostgreSQL/session, queue, Artifact, tester-sandbox, key-rotation,
reorg, Agent crash-delivery, acknowledged monitoring, trusted-proxy and KMS recovery drills, database backup/
restore smokes, then creates the
candidate snapshot as its last step. It keeps only SHA-256 digests of bounded
stdout/stderr, refuses an existing output or a path inside the source checkout,
detects source changes during the run, and writes the report mode 0600 only after
every command exits 0. A command timeout/output overflow or interruption produces
no successful report. The candidate recorded by this report—not an earlier
manual build—is the only candidate eligible for the final bundle.

Candidate manifest version 2 hashes every standalone server payload file,
including all Next.js server/static chunks, using a portable path/length/bytes
tree digest. It records the entry count and total bytes, binds safe internal
package symlinks while rejecting broken, absolute, escaping or mutable-target
links, and seals the payload files/directories read-only. Only `.next/cache` remains
owner-only writable for runtime cache data and is excluded explicitly. The QA
runner re-hashes the sealed payload before recording it. `serverSha256` remains
for diagnostics but is not treated as a complete candidate identity.

Copy `docs/production-release-draft.example.json` outside the repository and
replace every placeholder with the exact candidate build ID, immutable container
image digests, relative evidence paths and SHA-256 values. The evidence root must
be a real non-symlink directory; referenced files must be non-empty, regular,
not group/other writable and remain inside that root. The bundle binds these 12
preimages: candidate and deployment manifests, pilot sign-off, contract and
application QA, backup/restore, off-site backup, monitoring/alert drill, TLS/WAF/
trusted-proxy verification, KMS custody/recovery, and both independent audits.

After every preimage is final, generate the exact messages:

```bash
pnpm release:production:messages /secure/path/production-release-draft.json
```

The deployed protocol owner, an independent security reviewer and the operations
owner must be three distinct wallets. Each signs only the emitted EIP-191 message
after the manifest timestamp; private keys never enter AgentGrid. Add the three
signatures, make the completed bundle mode 0600, configure the four public paths
shown in `.env.production.example`, and run:

```bash
pnpm release:production:check
```

The command exits 2 until both the real-business pilot and final evidence bundle
are valid. It re-hashes every preimage, re-verifies all three signatures, requires
the protocol-owner signer to equal the deployment owner, parses the exact
22-command QA report, and binds the exact QA-created candidate, deployment and
pilot scope. The equivalent Admin route is
`GET /api/admin/release-readiness`; it is private and non-cacheable. File hashes
and signatures prove integrity and approval, not the truth of an external audit
or infrastructure report, so source reports and reviewer identities must be
retained independently.

The target edge report must be created from an independent external network
after the exact candidate and deployment exist. Configure a dedicated WAF drill
rule for `X-AgentGrid-WAF-Drill`, a public edge marker header, a global body cap
that still permits the valid 10 MiB hidden-test path, and run:

```bash
export EDGE_EVIDENCE_TARGET_CLASS=production-edge
export EDGE_EVIDENCE_VANTAGE_CLASS=external-independent
export EDGE_PROVIDER=<cdn-waf-provider>
export EDGE_PUBLIC_ORIGIN=https://agentgrid.example.com
export EDGE_HTTP_ORIGIN=http://agentgrid.example.com
export EDGE_DIRECT_ORIGIN=http://<origin-address>
export EDGE_MARKER_HEADER=x-agentgrid-edge
export EDGE_MARKER_VALUE=<public-edge-marker>
export EDGE_WAF_BODY_BYTES=12582912
export EDGE_WAF_RATE_LIMIT_ATTEMPTS=20
export EDGE_EVIDENCE_CANDIDATE_BUILD_ID=<exact-final-build-id>
export EDGE_EVIDENCE_DEPLOYMENT_MANIFEST_SHA256=sha256:<exact-deployment-file-hash>
export EDGE_SECURITY_REPORT_FILE=/secure/release-evidence/operations/tls-waf-trusted-proxy.json
export ADMIN_API_KEY_FILE=/run/secrets/admin_api_key
pnpm ops:edge:verify
```

The probe verifies the certificate chain/hostname/protocol/expiry, HTTP-to-HTTPS
redirect, HSTS and browser security headers, TRACE rejection, a 12 MiB 413, an
observed WAF 429, edge-marker presence, forwarding-header overwrite, trusted
proxy activation and direct-origin blocking. A publicly reachable origin that
merely returns application 401 is insufficient; the release gate requires a
network block or explicit external 403. Reports older than seven days, local
vantage reports and mismatched candidate/deployment hashes are rejected.

## KMS custody and recovery drill

Production recovery evidence covers exactly four launch-critical values:
`ARTIFACT_MASTER_KEY`, `PROTOCOL_OPERATOR_PRIVATE_KEY`,
`DEPLOYER_PRIVATE_KEY`, and `EVALUATOR_AGENT_WALLET_PRIVATE_KEY`. The external
provider observation is strict JSON metadata; it contains only SHA-256 hashes of
secret references, versions, KMS keys, access policies, audit exports, workload
principals and expected recovered-value fingerprints. It also records the three
expected public wallet addresses. Never put secret values in this JSON.

Run the drill as a separate, short-lived recovery workload after the exact
candidate and deployment manifest exist. Disable the original runtime first and
mount only the recovered versions into a mode-0700 directory using these exact
mode-0400 filenames:

```text
artifact_master_key
protocol_operator_private_key
deployer_private_key
evaluator_agent_wallet_private_key
```

The report path must be outside that mount and must not exist beforehand:

```bash
export KMS_PROVIDER_OBSERVATION_FILE=/secure/read-only/kms-provider-observation.json
export KMS_RECOVERY_SECRET_ROOT=/run/recovered-secrets
export KMS_EVIDENCE_CANDIDATE_BUILD_ID=<exact-final-build-id>
export KMS_EVIDENCE_DEPLOYMENT_MANIFEST_SHA256=sha256:<exact-deployment-file-hash>
export KMS_CUSTODY_REPORT_FILE=/secure/release-evidence/security/kms-custody-recovery.json
export KMS_RECOVERY_EPHEMERAL_JOB=true
export KMS_RECOVERY_ORIGINAL_RUNTIME_DISABLED=true
export KMS_RECOVERY_MOUNTS_SCOPED_TO_JOB=true
pnpm ops:kms:verify
```

The verifier refuses writable or symlink secret inputs and reports inside the
secret mount. It checks provider-recorded fingerprints, performs an AES-256-GCM
envelope round trip, signs and recovers a candidate/deployment-bound challenge
with all three wallets, and emits a new mode-0600 report containing no secret
values. A production report additionally requires workload identity, no
long-lived cloud credential, customer-managed encryption, rotation, audit
logging, deletion protection, a recovery window of at least seven days, current
cross-region versions, least-privilege policies, an isolated recovery source and
at least four distinct provider audit-event hashes.

`pnpm ops:kms:smoke` exercises the same cryptographic and filesystem path with
fresh temporary values. Its report is deliberately labelled `local-smoke`; the
release gate rejects it. The provider observation and generated report are
operator attestations, not proof supplied by the cloud itself. Retain the
read-only provider policy/audit exports named by the hashes and have all three
release signers inspect them independently. External provider configuration and
the real recovery run remain mandatory launch evidence.

## Metrics and backups

`GET /api/admin/metrics` requires `Authorization: Bearer $ADMIN_API_KEY` and
reports chain events, confirmed tasks, pending outbox entries, ready artifacts,
signed evidence, publisher-signed business adoptions, recent audit events, queue
depths and active leases.

The production `monitor` Worker evaluates those same durable metrics every
minute. Missing/stalled chain indexing, queue or outbox backlog, expired task
evaluations and notification backlog are delivered to `ALERT_WEBHOOK_URL` over
HTTPS. Each exact JSON body is authenticated with
`X-AgentGrid-Signature: sha256=<HMAC-SHA256>` using
`ALERT_WEBHOOK_SECRET`; state changes emit alert/recovery events and unresolved
conditions are repeated as `operational.reminder` every 15 minutes. Each body
contains a UUID `deliveryId` and explicit `eventKind`. A receiver must return
HTTP 2xx plus `Content-Type: application/json` and this bounded, strict response:

```json
{
  "accepted": true,
  "deliveryId": "the-request-delivery-uuid",
  "eventKind": "alert",
  "bodySha256": "sha256:<exact-request-body-hash>",
  "signatureVerified": true,
  "eventMatched": true,
  "receivedAt": "2026-08-31T00:00:00.000Z",
  "acknowledgementHmac": "sha256=<response-hmac>"
}
```

The response HMAC is calculated over
`agentgrid-alert-ack-v1\n` followed by the canonical JSON of the other seven
response fields in the order shown. It uses the same 32+ byte webhook secret but
a domain distinct from the request signature. AgentGrid verifies it with a
constant-time comparison.

Missing, oversized, non-JSON, false, stale, or mismatched acknowledgements fail
closed and are retried on the next monitor poll; monitor state advances only
after a valid acknowledgement. Redirects are rejected and the request/response
deadline is ten seconds. Production readiness remains 503 until the webhook URL
and a 32+ character secret are configured.

Before signing a release, exercise the actual incident receiver. This sends a
synthetic drill alert, waits at least 30 seconds, sends a reminder, then sends a
recovery. It writes only hashed receiver identity and acknowledgement metadata;
the HMAC secret is never written to the report:

```bash
export MONITORING_ALERT_TARGET_CLASS=production-https
export MONITORING_ALERT_RECEIVER_PROVIDER=<pager-or-incident-provider>
export MONITORING_ALERT_DRILL_REMINDER_DELAY_MS=30000
export MONITORING_ALERT_DRILL_REPORT_FILE=/secure/release-evidence/operations/monitoring-alert-drill.json
export MONITORING_EVIDENCE_CANDIDATE_BUILD_ID=<exact-final-build-id>
export MONITORING_EVIDENCE_DEPLOYMENT_MANIFEST_SHA256=sha256:<exact-deployment-file-hash>
export ALERT_WEBHOOK_URL=https://<actual-receiver>/agentgrid
export ALERT_WEBHOOK_SECRET_FILE=/run/secrets/alert_webhook_secret
pnpm ops:monitor:drill
```

The mode-0600 report is accepted by the production release gate only when all
three acknowledgements are exact, the report is no older than seven days, the
target is `production-https`, the delay is at least 30 seconds, and candidate and
deployment bindings match. `pnpm ops:monitor:drill:smoke` exercises the same
protocol against a loopback receiver, but labels its transport `local-smoke` and
cannot satisfy the production gate.

`pnpm ops:backup` writes a mode-0600 PostgreSQL custom-format dump and SHA-256
manifest under `BACKUP_DIRECTORY`. Set `BACKUP_RETENTION_DAYS` (7–3650) for
bounded local retention. If `BACKUP_S3_BUCKET` is configured, the dump and
manifest are copied to a dedicated off-host S3-compatible target. Production
requires an AWS/default or custom HTTPS endpoint plus `BACKUP_S3_KMS_KEY_ID`;
plain HTTP and non-KMS reports cannot pass the release gate. The backup service
receives two dedicated file-only S3 credentials, not the Artifact-store keys.
The local manifest records off-host success only after both uploads and a remote
object HEAD have succeeded; the manifest replacement is atomic, so an interrupted
upload cannot falsely claim an off-host copy.

`pnpm ops:backup:verify` verifies manifest size and SHA-256, streams rather than
buffers the dump into an exact disposable `agentgrid_restore_<timestamp>_<nonce>`
database, checks the eleven delivery/lifecycle core tables (including
`artifact_release_audit` and `business_adoption_attestations`), and drops only
that temporary database. With the exact candidate/deployment bindings configured,
it can write the mode-0600 `backupRestoreReport` preimage.

The off-host gate is stronger than a HEAD check:

```bash
export BACKUP_EVIDENCE_CANDIDATE_BUILD_ID=<exact-final-build-id>
export BACKUP_EVIDENCE_DEPLOYMENT_MANIFEST_SHA256=sha256:<exact-deployment-file-hash>
export BACKUP_RESTORE_REPORT_FILE=/secure/release-evidence/operations/backup-restore.json
pnpm ops:backup:verify
export OFFSITE_BACKUP_REPORT_FILE=/secure/release-evidence/operations/offsite-backup.json
pnpm ops:backup:offhost:verify
```

The second command downloads both objects again, compares the remote manifest
byte-for-byte, verifies length/metadata/dump SHA-256 while streaming into a mode-
0600 temporary file, restores that downloaded file, checks all eleven tables and
deletes the restore database and temporary dump. `BACKUP_OFFHOST_LOCAL_SMOKE=true`
exists only for local MinIO path testing; its report is labelled `local-smoke` /
`none-local-smoke` and is explicitly rejected by the production release gate.
For direct backups, the password is removed from the `pg_dump` process argument
and supplied only to the child process; the runtime image must include a compatible
PostgreSQL client. Dump completion requires both an exit-0 child and a fully
flushed output stream; stderr is bounded. The default local smoke path uses the
Compose PostgreSQL client.

Backups deliberately do not write `ARTIFACT_MASTER_KEY` or wallet keys. Those
must be backed up and rotated in an external secret manager; without the artifact
master key, encrypted delivery archives cannot be recovered.

To rotate the artifact envelope key, first put the new key in
`ARTIFACT_MASTER_KEY` and the old key(s), comma-separated, in
`ARTIFACT_PREVIOUS_MASTER_KEYS`. Deploy that dual-read configuration to all Web
and tester processes, pause artifact uploads/releases, then run
`pnpm ops:artifact-key:rotate`. After the command reports every delivery and
hidden-test envelope rotated, restart without `ARTIFACT_PREVIOUS_MASTER_KEYS`.
The command updates all envelopes in one PostgreSQL transaction and never logs
raw keys.

## Current production gate

The local production gates now cover durable state, encrypted immutable
delivery, sealed hidden tests, isolated executor/tester workers, randomized
assignment, dispute and maintenance automation, key rotation, confirmed-event
reorg handling, non-root containers, and a real backup/restore exercise. The
remaining mandatory gates are an actual BSC Testnet deployment and lifecycle
run using funded independent wallets, external TLS/secrets infrastructure,
independent Solidity/security review, and signed pilot-user acceptance.

Do not expose this service publicly until all gates are complete and the
Solidity contracts have received an independent security review.
