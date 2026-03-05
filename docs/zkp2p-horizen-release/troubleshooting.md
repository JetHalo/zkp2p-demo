# Troubleshooting

## Priority order
1. 模式/路由不一致
2. TLSNotary 插件/验真服务不一致
3. 环境变量层级污染
4. statement 重建不一致
5. gateway verify 未通过
6. 钱包签名与 gas/nonce

## Quick checks
```bash
rg -n "aggregation-kurier|aggregation-gateway|verificationMode" docs apps/web
rg -n "TLSN_VERIFIER_URL|NEXT_PUBLIC_TLSN_WISE_PLUGIN_URL" apps/web/.env.local docs/zkp2p-horizen-release
node scripts/zkp2p-horizen-release/check-statement.ts
rg -n "KURIER_API_KEY|NEXT_PUBLIC_" apps/web/.env.local.example docs/zkp2p-horizen-release/env-boundary.md
curl -sS "$THEGRAPH_SUBGRAPH_URL" -H 'content-type: application/json' --data '{"query":"{ _meta { block { number } } }"}'
```
