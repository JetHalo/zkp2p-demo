# Runbook

## 1. Prerequisites
- Node.js 20+
- Foundry (`forge`, `cast`)
- Noir toolchain (`nargo`)
- Browser prover runtime (`globalThis.__ZKP2P_NOIR_PROVER__`) locked to `ultrahonk`
- Horizen EON RPC endpoint

## 2. Mode + Route lock
- submission mode: `aggregation-kurier`
- verification route: `aggregation-gateway`
- proof system: `ultrahonk`
- indexer: `thegraph` (with sqlite fallback)

## 3. Env split
- `contracts/.env` 仅放部署签名与链写入变量。
- `apps/web/.env.local` 放 web/api 运行变量。
- Kurier key 只能存在服务端环境变量。
- `NEXT_PUBLIC_TLSN_WISE_PLUGIN_URL`（前端公开，TLSNotary plugin 地址）
- `TLSN_VERIFIER_URL`（服务端私有，attestation 验真服务）
- `TLSN_VERIFIER_TOKEN`（可选，服务端私有）

## 4. Start web
```bash
cd apps/web
npm run dev
```

## 4.1 Prepare The Graph
- 按 `docs/zkp2p-horizen-release/thegraph-subgraph.md` 使用本地 `subgraph.yaml` + Goldsky CLI 部署。
- 不使用 Goldsky 网页弹窗自动生成（避免 schema 与 `commitments.ts` 查询不一致）。
- 确认 `THEGRAPH_SUBGRAPH_URL` 已写入 `apps/web/.env.local`。

## 4.2 Load Proof Plugin
- Chrome 加载扩展目录：`apps/proof-plugin`
- 刷新 dApp 页面后，点击“启动 Proof 插件”
- 详细见：`docs/zkp2p-horizen-release/plugin-integration.md`

## 5. Deposit + Intent + Proof
1. Seller deposit
2. Buyer 调 `createIntent(..., deadline, ..., cleanupIntentIds)`（锁定额度）
   - `cleanupIntentIds` 由前端自动填入该 seller 已过期 intent 列表（可为空）。
   - 合约会在同一交易里先清理过期单，再锁新单。
3. 启动 proof 插件并进入 Wise TLSNotary 采集
4. 后端验真 attestation，生成 `wiseReceiptHash`
5. 提交到 Kurier/zkVerify

## 6. Buyer release with proof
- 拉取 aggregation tuple
- 运行 statement parity
- 由买方地址调用 `releaseWithProof(intentId, nullifierHash, domainId, aggregationId, leaf, merklePath, leafCount, index)`
- 合约内执行 `verifyProofAggregation(...)`
- 确认到账 + action_done

## 6.1 Timeout unlock (no cron required)
- 不需要频繁/定时调用合约。
- 过期 intent 在“下一次有人操作时”按需回收即可：
  - 单个：`cancelExpiredIntent(intentId)`
  - 批量：`cancelExpiredIntents([intentId...])`
- 建议在卖方下一次 withdraw 或买方下一次下单前顺手触发批量回收。

## 7. Troubleshooting order
1. mode/route mismatch
2. env mismatch
3. statement mismatch
4. gateway verify false
5. wallet/tx issues
6. subgraph lag/unavailable -> fallback sqlite
