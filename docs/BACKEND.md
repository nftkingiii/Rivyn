# Backend

## Components

- `InvoiceApprovalRegistry.sol` runs on Ethereum Sepolia and emits the buyer's approval.
- `RivynEscrowASC.sol` runs on Creditcoin CC3 Testnet, verifies Attestcoin proof data, decodes the source receipt, and releases or refunds native testnet CTC.
- `src/server.ts` exposes a stateless proof-building API. It never signs or submits a transaction.

## Local setup

```powershell
Copy-Item .env.example .env
npm install --ignore-scripts
npm run build
npm test
npm run server
```

Update `SOURCE_APPROVAL_CONTRACT` after deploying the Sepolia registry. Keep deployment keys outside the repository and never send them to the API.

## API

`GET /healthz` returns the service identity and version.

`POST /v1/proofs` accepts:

```json
{
  "txHash": "0x<32-byte Sepolia transaction hash>",
  "invoiceId": "0x<32-byte invoice ID>",
  "buyer": "0x<buyer>",
  "payee": "0x<payee>",
  "amount": "1000000000000000000"
}
```

The API checks the Sepolia network, mined receipt, successful status, configured event emitter, and exact invoice fields before asking the Attestcoin proof builder for a proof. `409 PROOF_NOT_READY` means the source block is not attested yet and the caller should retry later.

The returned `releaseCall` object maps directly to `RivynEscrowASC.releaseWithProof`. The wallet remains the transaction signer.

## Known deployment gap

The service is stateless and deliberately does not queue long-running proof jobs. The client retries after attestation; this avoids server-held signing authority and restart-sensitive in-memory jobs.
