# Task List (Stage 0.5 -> 7)

## Stage 0.5 - Lock
- [x] Lock submission mode (`aggregation-kurier`)
- [x] Lock verification route (`aggregation-gateway`)
- [x] Lock indexer strategy (`thegraph`)
- [x] Lock schema split (`businessDomain` vs `aggregationDomainId`)
- [x] Define acceptance + error matrix

## Stage 1 - Scaffold
- [x] Create roots: `apps/web`, `circuits`, `contracts`, `docs`, `scripts`
- [x] Create standalone plugin root: `apps/proof-plugin`
- [x] Create env split: `contracts/.env.example`, `apps/web/.env.local.example`
- [x] Create API stubs: `submit-proof`, `proof-status`, `proof-aggregation`, `commitments`

## Stage 2 - Circuit Intake
- [x] Create `circuits/zkp2p-horizen-release/INTAKE.md`
- [x] Define Noir main circuit I/O
- [x] Add statement check script

## Stage 3 - I/O Schema + Statement Parity
- [x] Define shared schema TS + docs
- [x] Implement statement reconstruction helper

## Stage 4 - Proof Relay / Status
- [x] Implement mode-safe payload builder
- [x] Validate binding + anti-replay at API boundary
- [x] Return machine-readable diagnostics

## Stage 4.5 - Contract Route Parity
- [x] Implement deposit/reserve/release/withdraw contract
- [x] Enforce nullifier anti-replay
- [x] Add Foundry tests for parity

## Stage 5 - UI State Machine + Wallet Gate
- [x] Render proof lifecycle: pending/verified/aggregated
- [x] Render consume lifecycle: aggregated_ready/buyer_signing/action_submitting/action_done
- [x] Disable release when wallet is not intent buyer

## Stage 6 - Visual System
- [x] Provide page scaffold and PRD-aligned sections

## Stage 7 - Indexer + Runbook + E2E
- [x] Add Graph-first indexer path with sqlite fallback
- [x] Add subgraph manifest/schema/mapping scaffold
- [x] Add runbook/troubleshooting/indexer ops docs
- [x] Add error matrix with shortest command
