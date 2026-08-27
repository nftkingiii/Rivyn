# Rivyn

**Cross-chain invoice release, proven before payment.**

Rivyn is an RWA invoice settlement desk. A buyer approves a specific invoice on Ethereum Sepolia; an Attestcoin proof is then verified inside a Creditcoin CC3 Testnet contract. Only a successful approval event from Rivyn's configured source contract, matching the escrow's invoice ID, amount, and payee, can release the escrowed testnet CTC.

## Why Attestcoin is load-bearing

Creditcoin does not trust a relayer, backend, or UI assertion that a Sepolia approval happened. The Creditcoin contract verifies the Ethereum transaction inclusion and chain continuity proof using the Attestcoin Block Prover precompile (`0x…0FD2`), decodes the verified receipt, and applies settlement logic atomically.

## Settlement boundary

1. Seller creates a Creditcoin invoice escrow for a fixed payee and amount.
2. Buyer calls the Sepolia `approveInvoice` source contract.
3. A proof worker obtains the Attestcoin inclusion proof after the source block is attested.
4. Rivyn verifies the proof on Creditcoin and releases the escrow only if the decoded event matches the escrow.

Rejected paths are first-class: a failed source transaction, approval emitted by another contract, wrong invoice/amount/payee, duplicate proof, or an already-finalized escrow must fail.

## Product status

The backend vertical slice is implemented locally:

- Sepolia buyer-approval registry.
- Creditcoin native-CTC invoice escrow with Attestcoin verification and strict receipt decoding.
- Stateless proof API with no signing key.
- Happy-path and adverse-state tests for exact terms, failed receipts, lookalike emitters, replay, expiry, request validation, CORS, and security headers.

The React interface is also implemented locally:

- Overview of the Sepolia → Attestcoin → Creditcoin settlement route.
- Wallet-driven fund, approve, and proof-backed release workflows.
- Explicit wrong-wallet, wrong-network, pending, error, success, and deployment-pending states.
- Client-side input preflight with the contracts retained as final authority.

No deployment, live transaction, or production integration claim is made yet. See [the proof matrix](docs/PROOF_MATRIX.md) for the verified-versus-missing boundary and [backend documentation](docs/BACKEND.md) for setup and API usage.

## Run the interface

Copy `.env.example` to `.env`, keep the two contract address fields empty until the real deployments exist, then run:

```powershell
npm run server
npm run web
```

The interface opens at `http://127.0.0.1:5173`. It intentionally blocks transactions until both public contract addresses are configured.

## Security boundary

Testnet only. Rivyn will not collect seed phrases or private keys. Proof data and submitted transaction hashes are untrusted until the on-chain verifier, receipt-status check, configured-source check, event-term checks, and replay check succeed.

## Verify locally

```powershell
npm install --ignore-scripts
npm run build
npm test
npm audit --audit-level=high
```

## References

- [Attestcoin SDK documentation](https://docs.creditcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-sdk-usc-sdk.md)
- [Attestcoin chain environments](https://docs.creditcoin.org/attestcoin-protocol/attestcoin-protocol-chains-environments.md)
- [Official examples](https://github.com/gluwa/attestcoin-protocol-examples)
