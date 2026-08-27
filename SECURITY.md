# Security

Rivyn is testnet-only and has not been audited.

## Trust boundaries

- A submitted transaction hash and every claimed invoice field are untrusted.
- The proof API performs a UX preflight but is not a settlement authority.
- `RivynEscrowASC` independently verifies the Attestcoin proof and checks the source chain key, successful receipt, configured Sepolia registry, event signature, invoice ID, buyer, payee, amount, invoice state, and query replay status.
- The API has no signing key and never accepts RPC or proof-builder URLs from requests.

## Abuse cases covered

- Proof from an unsupported source chain.
- Failed source transaction included in a valid block.
- Lookalike contract emitting the same event.
- Correct event with a wrong buyer, payee, amount, or invoice ID.
- Replaying one source transaction.
- Refunding before expiry or by anyone other than the funder.
- Oversized, malformed, cross-origin, or excessive API requests.

## Reporting

Do not test with real funds. Open a private security report with reproduction steps and no secrets.
