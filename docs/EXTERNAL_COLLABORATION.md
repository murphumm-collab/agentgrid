# AgentGrid external collaboration queue

Items in this file require real external authority, infrastructure, funds,
independent people or accountable review. Local automation may improve their
interfaces and verifiers, but may not fabricate or silently substitute the
evidence.

## Frontend and production edge

- **GitHub handoff needed:** the current local branch is
  `codex/verification-arbitration` and carries commits not present on
  `origin/main`. HTTPS
  push currently fails because this machine has no readable GitHub credential.
  The product owner must authenticate Git for
  `https://github.com/murphumm-collab/agentgrid.git` or provide an approved SSH
  remote; no token may be committed or pasted into ordinary project files.

- **Needed from product owner:** choose Vercel, Cloudflare or an owned server;
  authorize the account/project and identify the production or preview domain.
- **Then required:** deploy the exact candidate, configure TLS, WAF/rate limits
  and the authenticated trusted proxy, set `AUTH_ORIGIN` to that exact HTTPS
  origin, run the external edge verifier, and bind
  its report to the candidate and BSC deployment manifest.
- Current state: the frontend and AI-friendly Dashboard exist locally. Current
  immutable candidate `Pb3ElgGhqtgYphGdsAF35` is bound to source
  `sha256:13cc42019c00dcb662298d8812f7b517276285caabb0d331bc3be355736eff58`
  by the uninterrupted 22-command QA at
  `/Users/mac/.agentgrid-release-evidence/agentgrid-qa-ee184be/application-qa.json`
  and remains unactivated. Its discovery schema 1.1, OpenAPI 0.8.16, Dashboard
  schema 2.6, ten-contract runtime manifest and local production bundle are
  verified for that exact source. No public URL has been deployed or represented
  as production;
  deployment still requires the product owner's hosting/domain authorization
  and the external edge evidence above.

## BSC Testnet deployment

- Fund the testnet-only deployer with at least `0.1 tBNB` and retain funding
  transaction evidence.
- Supply distinct owner multisig/timelock, Coordinator, reserve, DAO treasury,
  security reserve, CompetitionSlotPass issuer and at least three arbitrator
  addresses with the configured quorum. The two public paid-capacity signer
  addresses are configuration inputs only; their private keys must remain in
  an external controlled signing workflow.
- Authorize the explicit testnet broadcast only after the preflight returns
  `broadcastReady:true`.
- Current read-only chain-97 preflight compiles all ten contracts but returns
  `broadcastReady:false` for the missing three arbitrators/quorum, deployer key,
  owner, Coordinator, CompetitionSlotPass issuer, DAO treasury and security
  reserve. These values require external custody decisions and must not be
  synthesized locally.
- Provision explicitly separated publisher, three evaluator, executor, three
  validator, three staked arbitration and coordinator wallets; do not compress
  this requirement into a fragile participant count.

## Independent pilot participants

- Select an independently governed Sybil/common-control attestation mechanism
  for publisher and Agent wallets. The pilot must prove that related wallets are
  grouped or rejected without exposing unnecessary identity data; separate
  addresses, self-declared labels and project-controlled test wallets are not
  independence evidence. Until this exists, mainnet quality incentives remain a
  mandatory external gate even though local relationship and low-value caps apply.

- At least three unrelated publishers must complete real-business tasks.
- Three independently operated validation Agents must each receive only their
  frozen criterion/test shard, commit before reveal and cross-check the other
  two reports; wallet address difference alone is insufficient proof of
  independence.
- Three independently controlled arbitration identities must each deposit at
  least 500 Token. The pilot must record the 50-Token protocol bond floor and
  the challenger's full locked available-stake snapshot (which is at least 500
  Token under the current eligibility rule), matching
  2-of-3 resolution hashes, a correct challenge with validator/reward/reserve
  accounting, and repeated false challenges at 5%/15%/30%. It must also exercise
  one role-rehabilitation appeal with an independently reviewed evidence hash,
  an exact matching 2-of-3 decision, restored 2500-bps floor, one rejected appeal
  penalty and one three-day no-quorum unlock; project-controlled wallets cannot
  stand in for independent appellants or arbitrators.
- Archive the canonical `PanelStarted` epoch, all shard commit/reveal events,
  arbitration stake totals, challenge stake snapshots and resolved penalty-bps
  fields. A checklist assertion or transaction hash without the decoded fields
  cannot satisfy `pilot:qualification:check`.
- Complete both collaboration and competition tasks, structured rejection and
  quorum appeal, maintenance day 7/30/90 behavior, repeated-collaboration reward
  decay and signed business-adoption attestations.

## Production custody, recovery and monitoring

- Select and authorize the production Secret Manager/KMS provider.
- Configure recoverable deployer/operator/artifact keys without plaintext image
  layers or repository copies.
- Select encrypted off-host backup storage, retention policy and restore-drill
  owner.
- Provide a real HTTPS alert receiver and complete alert/reminder/recovery
  acknowledgement evidence.

## Independent review and approval

- Commission independent Solidity and Web/API security reviews and close all
  high/critical findings.
- Assign support, dispute, incident-response and rollback owners.
- Collect the required independent pilot reviews and six-role EIP-191 pilot
  sign-off bundle.
- Collect three distinct owner/security/operations signatures over the final
  production release manifest.

## Token economics, treasury and paid distribution

- Select an independently controlled promotion-attestation wallet and a
  confirmed USDT/USDC/BNB payment-receipt source. The application receives only
  `PROMOTION_ATTESTATION_SIGNER`; the signing key stays outside the Web/API
  runtime. Exercise receipt replay, expiry, revocation/refund and accounting
  reconciliation before accepting public paid placement. Local signed fixtures
  cannot prove that money was received.

- Product owner and qualified legal/tax counsel must review the 95/3/2 task-
  reward split, staged 1.5% stake consumption, burn treatment, referral income,
  advertising, sponsorship, appeal fees and maintenance renewal in every
  intended jurisdiction. Local code and simulations cannot close this row.
- DAO/timelock, security reserve, official distribution recipient and
  180–365-day source-fee vesting addresses must be independently controlled and
  approved before deployment; the operating company must not hold an
  unrestricted key that can withdraw DAO funds.
- Stablecoin/BNB advertising intake, DEX route, TWAP oracle, maximum slippage,
  MEV controls, execution cadence and per-period buyback cap require funded
  testnet/mainnet liquidity evidence and an independent contract/economic
  security review. Until then, automatic buyback is local simulation only.
- Any public task-volume, USD revenue, buyback, burn or AGT net-demand number
  must come from confirmed indexed transactions. Scenario assumptions must be
  labelled as scenarios and must never be presented as realized revenue or a
  token-price promise.

## Evidence handoff rules

Provide references or secrets only through the approved secret/file mechanism;
never paste private keys, API keys, artifact keys or signed download URLs into
Git, Issues, ordinary chat or this document. External reports must name the
exact candidate build ID and deployment manifest hash that they evaluated.
