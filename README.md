# zkp2p

PRD-aligned scaffold for **plugin aggregation + zkVerify + on-chain release on Horizen**.

## Locked decisions
- submission mode: `aggregation-kurier`
- verification route: `aggregation-gateway`
- indexer strategy: `thegraph`
- circuit language: `Noir`
- router: `Pages Router`

## Structure
- `apps/web` - Next.js UI + API (`submit-proof`, `proof-status`, `proof-aggregation`, `commitments`)
- `contracts` - Foundry contract and tests
- `circuits/zkp2p-horizen-release` - circuit intake and Noir stub
- `docs/zkp2p-horizen-release` - orchestrator outputs and runbook
- `scripts/zkp2p-horizen-release` - statement check + indexer helpers

## Quick start
```bash
cp apps/web/.env.local.example apps/web/.env.local
cp contracts/.env.example contracts/.env

npm run dev:web
```

## Proof Plugin Installation
1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `/Users/jethalo/projects/zkp2p/apps/proof-plugin`.
5. Refresh the zkp2p web page after the extension is loaded.
