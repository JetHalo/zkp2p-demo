# UI Pages Spec (PRD-Aligned)

Source prompt file: `docs/zkp2p-ui-generation-prompts.md`

This folder contains 8 page-level UI specs mapped to PRD flow:
1. Seller Deposit Pool Overview
2. Buyer Intent + Quota Check
3. Intent Success + Plugin Launch
4. Proof Status Tracking
5. Buyer Signature + On-chain Verify
6. On-chain Submitting
7. Release Success + Replay Guard
8. Error & Retry Center

Rules:
- Keep wording as `Deposit 池` / `deposit pool` (no `escrow`).
- Keep lifecycle states visible: `pending -> verified -> aggregated`.
- Keep consume stages visible: `aggregated_ready -> buyer_signing -> action_submitting -> action_done`.
- Do not show finalize CTA when wallet is not the intent buyer.
