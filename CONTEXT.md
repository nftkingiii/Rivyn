# Rivyn Context

- **Invoice**: a unique Creditcoin escrow identified by a `bytes32` ID.
- **Funder**: the account that locks testnet CTC and can reclaim it after expiry.
- **Buyer**: the Ethereum Sepolia account whose approval is required; it may differ from the funder.
- **Payee**: the seller or supplier that receives the escrow after proof verification.
- **Approval**: a successful `InvoiceApproved` event emitted by Rivyn's configured Sepolia registry with exact invoice ID, buyer, payee, and amount.
- **Proof service**: a stateless helper that preflights the source receipt and returns Attestcoin proof parameters. It has no settlement authority or signing key.
