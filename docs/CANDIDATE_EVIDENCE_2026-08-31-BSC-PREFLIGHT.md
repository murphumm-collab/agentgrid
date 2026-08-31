# AgentGrid BSC Testnet deployment preflight — funding required

Recorded 2026-08-31 (Asia/Hong_Kong). This is a read-only live BSC Testnet
preflight. No transaction was signed or broadcast.

## Live result

`pnpm contracts:deploy:check` connected to chain ID 97, compiled all six required
contracts and reduced the deployment blockers to one:

```json
{
  "deployer": "0x077A2e71d3EaB62F001Ad0Fff957f3627e6E78d1",
  "balanceTbnb": "0",
  "minimumBalanceTbnb": "0.1",
  "broadcastReady": false,
  "blockers": ["DEPLOYER_TBNB_UNDERFUNDED"]
}
```

The mode-0600 preflight evidence is:

```text
<agentgrid-workspace>/release-evidence/bsc-testnet-deployment-preflight-20260831-0756.json
SHA-256 ce17b87eb9d0e838fe6cf219a4a3166815eb73a33786942b2f12af348bf45fac
```

The deployment command was not run and its explicit broadcast acknowledgement
was not set. There is no pending run file or deployment manifest.

## Testnet-only role bundle

The generated bundle lives outside the source and release candidates:

```text
<agentgrid-workspace>/secure-testnet/bsc-testnet-role-bundle-20260831-0755
public bundle SHA-256: sha256:5a2019c4254bbc99f0a8a3271b37130f0b2ff3e8a5f0c55f13c1299432b2f9c2
```

The bundle and private directory are mode 0700, each of the 13 testnet private
key files is mode 0400, and public/environment metadata is mode 0600. Private
values were not printed or copied into the source tree.

Public addresses:

```text
deployer     0x077A2e71d3EaB62F001Ad0Fff957f3627e6E78d1
owner        0x6471ad57a4f8e322Aa23576C9f0f70F2d467E29E
coordinator  0x0bd437a9Cc2EB07d01C3067f870e258e1c7DFe7c
reserve      0x848B614a0cBcb2EB34210762441334566b172877
arbitrator1  0xfb78ec408f74f38138B8d9df10cEcAd06542dAfb
arbitrator2  0x172fc7A4Ce77Bd17119C7B29435EdaEbB2F7A551
arbitrator3  0x3675C666Ee1146C9EBa474FF0699f4feFA64121C
publisher    0x63293CAA17660b8EbfC49779F326E161A60fB5e8
evaluator1   0x332E107d8586e5fcfDd68E9f6Ec5f73eAd3F90F9
evaluator2   0x5983F94701EeAFC1e4fEB2508265f3818eC4bd93
evaluator3   0xC18cdBAC78cD9A1e7CCC4322710e91F730b7f689
executor     0x7f161F849c114d541c35bCf9147adF869AD975af
tester       0x36bCDF83E6A687f65Cf3C2bD850d54711c5Dc141
```

These wallets are explicitly labelled
`single-operator-generated-not-independent`. They are suitable for a synthetic
testnet lifecycle after funding, but they do not satisfy the real-user or
independent-operator pilot gates. The generated owner is an EOA, not the required
production multisig/timelock.

## Funding needed for the next automated step

- Send at least `0.1` tBNB to the deployer address above. Only after the live
  preflight reports `broadcastReady:true` may the explicit deployment broadcast
  acknowledgement be considered.
- After deployment, the synthetic pilot preflight requires at least `0.02` tBNB
  each for publisher, evaluator1, evaluator2, evaluator3, executor, tester and
  coordinator.

Funding is an external action. AgentGrid will not treat a faucet request, wallet
address or local key as proof of independent control.

## Current final gate

The read-only production release check still returns exit 2 with 20 blockers.
It correctly reports no signed release bundle, no BSC deployment, zero real
adopted tasks/publishers/Agent wallets, missing dispute/maintenance/decay
evidence and missing six-role pilot sign-off. The successful 22-command QA report
is not counted until a final 12-preimage release bundle references it.
