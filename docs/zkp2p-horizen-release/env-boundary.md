# Env Boundary

## Public (can be exposed)
- `NEXT_PUBLIC_CHAIN_ID`
- `NEXT_PUBLIC_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_BUSINESS_DOMAIN`
- `NEXT_PUBLIC_TLSN_WISE_PLUGIN_URL`

## Server-only
- `KURIER_API_URL`
- `KURIER_API_KEY`
- `KURIER_API_ID` (optional; defaults to `zkp2p`, legacy alias: `KURIER_APP_ID`)
- `KURIER_AGGREGATION_DOMAIN_ID`
- `KURIER_VK_HASH` (from Kurier `/register-vk` response)
- `KURIER_PROOF_VARIANT` (`Plain` for `bb prove`, `ZK` for `bb prove --zk`; optional default `Plain`)
- `THEGRAPH_SUBGRAPH_URL`
- `TLSN_VERIFIER_URL`
- `TLSN_VERIFIER_TOKEN` (optional)

## Contracts-only
- `PRIVATE_KEY`
- `RPC_URL`
- `USDC_ADDRESS`
- `DEPOSIT_POOL_ADDRESS`
