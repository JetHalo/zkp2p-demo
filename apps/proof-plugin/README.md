# zkp2p Proof Plugin

Standalone browser extension for PRD flow:
1. Intent created in dApp
2. Plugin opens Wise page and runs TLSNotary plugin capture
3. Plugin asks verifier for `recentTransfers` (default 5) and renders list in popup
4. User selects one payment; plugin verifies selected transfer attestation and gets `wiseReceiptHash`
5. User clicks verify to start browser-only proving (no witness upload)
6. Submit proof to `/api/submit-proof`
7. Poll `/api/proof-status` and fetch `/api/proof-aggregation`
8. intent buyer triggers on-chain `releaseWithProof(...)`

## Directory
- `manifest.json` - MV3 config
- `background.js` - session orchestration and API calls
- `content-script.js` - dApp <-> extension bridge
- `inpage-bridge.js` - exposes `window.zkp2pProofPlugin`
- `popup.*` - operator controls for capture/prove/submit/status
- `lib/` - schema validation, security checks, proving adapter

## Install (dev)
1. Open Chrome Extensions page.
2. Enable developer mode.
3. Load unpacked extension from `apps/proof-plugin`.
4. Refresh dApp page (`http://localhost:3000/zkp2p-horizen-release`).

## Security rules
- Never place Kurier API key in plugin or dApp frontend.
- Plugin sends proof to your backend API only.
- TLS attestation must be verified by backend before proving.
- `proofId` freshness and `nullifier` anti-replay are enforced.
- `businessDomain`, `appId`, `buyerAddress` are always bound in payload.
- `wiseReceiptHash` is required and bound to circuit witness.

## Prover runtime
Plugin requires a real browser prover runtime:
- Register `window.__ZKP2P_NOIR_PROVER__.prove(witness)` on the dApp page runtime.
- Background worker now executes proving in the dApp tab (`senderTabId`) via `chrome.scripting.executeScript`.
- Prover runtime must be locked to `ultrahonk`.
- Return `{ proof: string, publicInputs: string[] }`.
- Plugin now derives real Noir witness inputs before proving:
  - `statement` and `nullifier` are recomputed and must match session/on-chain values.
  - `wise_witness_hash` is recomputed in-plugin from `{amount,timestamp,user_addr,wise_receipt_hash,secret}`.
  - `proverSecret` must be present in the proof session payload.

### Runtime bootstrapping in this repo
- `apps/web/pages/api/circuit-artifact.ts` serves compiled Noir circuit JSON.
- `apps/web/src/zk/zkp2p-horizen-release/browser-prover.ts` installs `window.__ZKP2P_NOIR_PROVER__`.
- `apps/web/pages/zkp2p-horizen-release.tsx` initializes prover on page mount.

## Required proof lock
- `verificationMode`: `aggregation-kurier`
- `proofSystem`: `ultrahonk`

## Required startProof fields (TLS flow)
- `wiseAttestationEndpoint`: backend route for attestation verification (`/api/verify-wise-attestation`)
- `tlsnPluginUrl`: TLSNotary plugin URL (set via `NEXT_PUBLIC_TLSN_WISE_PLUGIN_URL`)
