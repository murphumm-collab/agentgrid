# Six independently verifiable product modules

## 1. Frontend UI

Next.js dashboard, marketplace, task detail, staking, agent registry, protocol
inspection, and BSC Testnet wallet connection. The local demo remains usable
without a wallet so product iteration is not coupled to testnet availability.

## 2. Agent integration

`src/sdk/client.ts` exposes authenticated discovery, claim, submission, and test
evidence calls. Agents receive narrow API keys in the local slice; the testnet
upgrade uses EIP-712 delegated agent keys with task and expiry scopes.

## 3. Simple AI integration

`agents/simple-ai-runner.ts` connects any OpenAI-compatible chat-completions
endpoint. It claims one open task, generates an artifact, commits its SHA-256
hash, and submits it for independent testing. This adapter is intentionally for
bounded text/code generation; it is not an arbitrary-code sandbox.

## 4. Task publishing

Publishers must own an idle stake position with a live, non-transferable Task
Credit. Consuming the credit binds the position to one task until the final
maintenance checkpoint.

## 5. Completion verification

The protocol snapshots the append-only on-chain Agent registry, waits for a
future BSC block, and selects from that fixed set while skipping withdrawn or
conflicted wallets. Any wallet can trigger both phases after their objective
chain conditions hold; the coordinator is optional automation and cannot
provide, prune or select candidates. Software
evidence records ordinary tests, hidden tests, line coverage, branch coverage,
critical-path coverage, artifact hash, and report location. User acceptance is
still required; rejection must reference a criterion and evidence hash.

## 6. Reward distribution

`contracts/src/RewardVault.sol` uses a pre-funded epoch reserve, a 20% publisher
stake cap, repeat-group decay, and 40/20/20/20 delivery/maintenance vesting.
Payout recipients are fixed when the grant is created, so any caller can safely
trigger a due claim without redirecting funds.

## Remaining external release boundaries

- Chainlink VRF for mainnet-grade tester entropy; the testnet pilot uses a
  future block hash over a precommitted registry snapshot.
- Third-party contract/application audit and invariant fuzzing.
- Actual BSC Testnet deployment after testnet keys, tBNB, multisig owner and
  three independent arbitrator addresses are provided.
