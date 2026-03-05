# Env Schema

## apps/web/.env.local
- `NEXT_PUBLIC_CHAIN_ID` (number)
- `NEXT_PUBLIC_CONTRACT_ADDRESS` (address)
- `NEXT_PUBLIC_BUSINESS_DOMAIN` (string)
- `NEXT_PUBLIC_TLSN_WISE_PLUGIN_URL` (url)
- `KURIER_API_URL` (url, server-only)
- `KURIER_API_KEY` (string, server-only)
- `KURIER_AGGREGATION_DOMAIN_ID` (string, server-only; testnet `175`, mainnet `3`)
- `KURIER_API_ID` (optional string, server-only; defaults to `zkp2p`; legacy alias: `KURIER_APP_ID`)
- `KURIER_VK_HASH` (string, server-only; `/register-vk` 返回的 `vkHash`)
- `KURIER_PROOF_VARIANT` (optional string, server-only; `Plain` or `ZK`, default `Plain`)
- `THEGRAPH_SUBGRAPH_URL` (url, server-only)
- `TLSN_VERIFIER_URL` (url, server-only)
- `TLSN_VERIFIER_TOKEN` (string, server-only, optional)

## contracts/.env
- `RPC_URL` (url)
- `PRIVATE_KEY` (hex)
- `USDC_ADDRESS` (address)
- `DEPOSIT_POOL_ADDRESS` (address)
