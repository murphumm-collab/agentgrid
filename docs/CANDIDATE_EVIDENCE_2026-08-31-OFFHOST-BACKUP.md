# AgentGrid off-host backup hardening evidence — unactivated candidate

Recorded 2026-08-31 (Asia/Hong_Kong). This proves the local implementation and
failure behavior. It is deliberately not target off-host/KMS evidence and does
not approve production launch.

## Candidate

- Build ID: `kU9wkkJBf5TClNDZAVe8x`.
- Snapshot:
  `<agentgrid-workspace>/local-releases/agentgrid-20260830T220729Z-kU9wkkJB`.
- Release-manifest SHA-256:
  `93df65d7023f4b0daf7ef98427403094c7a9b88265edf00853ce369f18dbde08`.
- Manifest remains `immutableSnapshot:true`, `activationRequired:true`.

## Production topology fix

- The `backup` service now receives bucket, prefix, region, endpoint and KMS-key
  configuration.
- It mounts two dedicated file-only external Secrets:
  `backup_s3_access_key` and `backup_s3_secret_key`; it does not reuse Artifact
  store credentials.
- The Secret smoke now expands both `agents` and `ops` profiles. It passed with
  13 services, 13 external Secrets, no plaintext sensitive environment, and all
  role-specific mounts verified.
- `docker-compose.production.yml` SHA-256:
  `6438ba3521c2b1b4ff923b59d99eb06dafd2ae7c6d7b73b24e3fda8d3be51816`.

## Backup and restore safety

- `pg_dump` succeeds only after both child exit 0 and output-stream `finish`;
  stderr is bounded to 64 KiB.
- Local and downloaded dumps are streamed into `pg_restore`, not loaded into
  process memory.
- Manifests and dumps are opened without following symlinks, size/hash checked,
  and required to be non-writable by group/others.
- The off-host success marker is committed atomically only after dump upload,
  remote manifest upload, and remote HEAD verification.
- A nonexistent-bucket exercise exited 1 with `The specified bucket does not
  exist`; the retained valid local manifest had `hasOffHost:false`.
- No disposable `agentgrid_restore_*` database remained after any exercise.

## Upload, redownload and restore exercise

The local MinIO exercise intentionally used
`BACKUP_OFFHOST_LOCAL_SMOKE=true`. It uploaded a 32,781-byte PostgreSQL custom
dump, then a separate command downloaded the remote manifest and dump, compared
the manifest byte-for-byte, verified object length, SHA-256 metadata and streamed
dump SHA-256, restored the downloaded file, found all ten lifecycle/delivery
tables, dropped the database and removed the temporary file.

- Local restore evidence SHA-256:
  `4b0912d758148bcaf747b16a4b8aa4e842cd21be12fedb1cf8e6a243a66e7811`.
- Downloaded-object restore evidence SHA-256:
  `ea6c17f6a80b86b3f862c2391f3e6bf91b7e82b7c2bbdbd6d2c61133f235d680`.
- Both evidence files are mode 0600.
- The release binding verifier accepts their internal checks but returns exactly:
  `PRODUCTION_RELEASE_OFFSITE_TARGET_NOT_PRODUCTION` and
  `PRODUCTION_RELEASE_OFFSITE_KMS_REQUIRED`.

This proves the code path without turning local MinIO into false launch evidence.
A real final report must come from an AWS/default or custom HTTPS endpoint with
`aws:kms`, and must bind the exact final candidate and BSC deployment manifest.

## Regression evidence

- Application tests: 33 files, 135 tests passed.
- TypeScript, ESLint, 12 Worker bundles, production Compose and Next production
  build passed; 21/21 static pages generated.
- Production dependency audit: no known vulnerabilities.
- Candidate routes `/`, `/tasks`, `/tasks/new`, `/agents`, and
  `/agents/integration`: HTTP 200 on temporary port 3101.
- Admin release readiness: HTTP 401 without credential; authorized report remains
  `productionReleaseReady:false`, `verifiedBackupRestores:0` until a signed final
  bundle contains valid production backup reports.

## Deployment isolation

- PID `52463`, its original start time and working directory
  `<agentgrid-workspace>/local-releases/agentgrid-20260831-0129`
  remained unchanged.
- Existing `/` and `/agents/integration` remained HTTP 200.
- Port 3101 was stopped; no candidate was activated and no BSC transaction was
  broadcast.

## Still external

The target bucket/KMS policy, workload identity or dedicated credential custody,
off-host retention, scheduled restore observation and operator sign-off do not
exist locally. They remain mandatory release blockers alongside BSC deployment,
real-business pilot, TLS/WAF, alert drills and independent audits.
