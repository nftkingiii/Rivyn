# Deployments and live evidence

All values below were read back from the named testnets on 2026-08-27. Rivyn remains testnet-only.

## Public app

- App and proof API: [https://rivyn.up.railway.app](https://rivyn.up.railway.app)
- Health and live revision: [https://rivyn.up.railway.app/healthz](https://rivyn.up.railway.app/healthz)
- Deployment source: GitHub `main`; Railway rebuilds from the public repository.
- Rollback path: redeploy the last known-good Railway deployment or revert the failing commit on `main`.

Production verification on 2026-08-29 confirmed the app page and hashed assets returned HTTP 200, the health revision matched the deployed Git commit, and the public proof endpoint rebuilt the approval proof for block `11579322` with chain key `1`, eight Merkle siblings, and 79 continuity roots.

## Contracts

| Network | Contract | Address | Deployment transaction |
| --- | --- | --- | --- |
| Ethereum Sepolia | `InvoiceApprovalRegistry` | [`0xA319834D29875902762747655E8364d8605Da4eD`](https://sepolia.etherscan.io/address/0xA319834D29875902762747655E8364d8605Da4eD) | [`0x572d…584d`](https://sepolia.etherscan.io/tx/0x572d790b7f7f7a336a515ecff44560bc82d2a5699a23aeef63ca8e966467584d) |
| Creditcoin CC3 Testnet | `EvmV1Decoder` | [`0xA319834D29875902762747655E8364d8605Da4eD`](https://creditcoin-testnet.blockscout.com/address/0xA319834D29875902762747655E8364d8605Da4eD) | [`0xeb69…bb4c`](https://creditcoin-testnet.blockscout.com/tx/0xeb692de669d81d663d7d6866ace7390cf35264eb5bc0ac03dbde902103c1bb4c) |
| Creditcoin CC3 Testnet | `RivynEscrowASC` | [`0xd6F970246927d543F38b6A7f91311622283C13f0`](https://creditcoin-testnet.blockscout.com/address/0xd6F970246927d543F38b6A7f91311622283C13f0) | [`0x086d…68fc`](https://creditcoin-testnet.blockscout.com/tx/0x086d9a131e92563536f259faf67fd44527e44ee2e787950a74fb008c1aed68fc) |

The escrow read-back resolves the Sepolia registry above, Attestcoin verifier `0x0000000000000000000000000000000000000FD2`, and source chain key `1`.

Source verification status:

- `InvoiceApprovalRegistry`: Sourcify `exact_match` (verification timestamp `2026-08-27T18:31:04Z`).
- `EvmV1Decoder`: Creditcoin Blockscout `Pass - Verified`.
- `RivynEscrowASC`: Creditcoin Blockscout `Pass - Verified`; explorer read-back reports `is_changed_bytecode=false` and constructor argument `0xA319834D29875902762747655E8364d8605Da4eD`.

## First proof-bound settlement

- Invoice ID: `0x3ca6ab04d92fc9bb4f569e07ca4a80c95ac6cc94a89da35baaed0b62ed6fe81a`
- Amount: 1 tCTC
- CC3 funding: [`0x2537…8265`](https://creditcoin-testnet.blockscout.com/tx/0x2537949c64eb7c4089866cd85c9ea3d1e1137a697635998ab6b3b26b943e8265)
- Sepolia buyer approval: [`0x211b…404a`](https://sepolia.etherscan.io/tx/0x211bfe98d434a7e7a833c1574a592aa79699b61217a61ff62cee97cde711404a)
- Attestcoin-backed CC3 release: [`0xd0b8…3018`](https://creditcoin-testnet.blockscout.com/tx/0xd0b84c96cf59b88984c8e13e97b7f4ac4170cac69b2a949bcaa97f3d42d43018)
- Consumed query ID: `0xc04af1731bb4ffff83049e2d6ed6e53a99511f1231fc4a87b9b7ae1ce999d8fe`

Post-release read-back confirmed invoice status `Released`, consumed query state `true`, zero remaining escrow balance, and a 1 tCTC payee balance. Replaying the same payload reverted with `InvoiceNotFunded()`.
