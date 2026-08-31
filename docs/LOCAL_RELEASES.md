# Local release isolation

The process serving port 3000 must never run from the source workspace. A
`next build` replaces `.next` incrementally and can break a live server.

After all release gates pass, create a new immutable candidate without touching
the active deployment:

```sh
pnpm release:local:snapshot
```

The command copies the standalone server, matching static assets and public
assets into a new timestamped directory under `../local-releases`. It never
overwrites an existing release and writes `release-manifest.json` with the Next
build ID and server checksum.

Start the candidate on an unused port and verify `/`, `/agents`,
`/agents/integration`, `/tasks`, `/tasks/new`, and at least one referenced
`/_next/static/` asset. Only then may an operator stop the old process and start
the candidate on port 3000. Source builds and tests do not activate releases.
