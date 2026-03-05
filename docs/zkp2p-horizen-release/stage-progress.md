# Stage Progress

- Case: `zkp2p-horizen-release`
- Branch: `codex/zkp2p-horizen-release-stagewise`
- Locked mode: `aggregation-kurier`
- Locked route: `aggregation-gateway`
- Locked indexer: `thegraph`

## Stage status
- Stage 0.5: ✅ done
- Stage 1: ✅ done (scaffold/env/global styles)
- Stage 2: ✅ done (Noir intake + Nargo + prover input example)
- Stage 3: ✅ done (shared schemas + statement module)
- Stage 4: ✅ done (mode-safe API + diagnostics)
- Stage 4.5: ✅ done (buyer createIntent + releaseWithProof + timeout cancel in contract + tests)
- Stage 5: ✅ done (proof/wallet gate state machine)
- Stage 6: ✅ done (PRD-aligned flow page layout + 8-page UI docs)
- Stage 7: 🔄 in progress (The Graph deployment + e2e verification pending; plugin folder completed)

## Remaining in Stage 7
- Deploy subgraph with real `subgraph.yaml` address/startBlock
- Fill `abis/Zkp2pDepositPool.json` from build artifact
- Verify `/api/commitments` returns `strategy: thegraph` with `fallbackUsed: false`
- Run end-to-end deposit -> intent -> proof -> tuple -> buyer releaseWithProof
