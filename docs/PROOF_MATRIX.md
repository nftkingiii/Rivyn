# Proof Matrix

| Requirement | Implementation | Required evidence | Status |
| --- | --- | --- | --- |
| Attestcoin integration | `RivynEscrowASC.releaseWithProof` calls the CC3 Block Prover and decodes the verified Sepolia receipt | CC3 deployment, successful proof transaction, verifier event, contract read-back | Local implementation only |
| Exact counterparty approval | Configured registry, invoice ID, buyer, payee, and amount are checked on-chain | Sepolia approval transaction and matching CC3 release | Local tests pass |
| Failed source transaction | Receipt status must equal `1` | Reverting release test / transaction | Local test passes |
| Lookalike event rejection | Event emitter must equal the configured registry | Wrong-source adverse proof | Local test passes |
| Replay rejection | A transaction query ID can be consumed once | One proof containing two approvals; second release rejected | Local test passes |
| Escrow recovery | Only the funder can refund after expiry | Early/non-funder rejection and successful expired refund | Local tests pass |
| Proof API boundary | Strict request schema, explicit CORS, size cap, rate limit, generic errors, no signing key | API tests and response-header inspection | Local tests pass |
| Testnet deployment | Sepolia registry, CC3 escrow, public proof API | Addresses, hashes, explorer links, health URL | Missing |
| Live user flow | Wallet approval -> proof generation -> wallet release -> read-back | Clean-browser transaction chain | Missing |
