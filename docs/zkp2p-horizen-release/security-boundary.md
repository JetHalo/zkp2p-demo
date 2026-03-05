# Security Boundary

- Browser-only proving，服务端禁止 witness。
- `KURIER_API_KEY` 仅服务端可见。
- TLSNotary attestation 必须先走服务端 `verify-wise-attestation` 验真。
- 强制绑定 `businessDomain/appId/userAddr`。
- 强制 anti-replay（`nullifier`）。
- 强制 anti-replay（`wiseReceiptHash`）。
- 强制 freshness（`proofId == activeProofId`）。
- `contracts/.env` 与 `apps/web/.env.local` 严格隔离。
