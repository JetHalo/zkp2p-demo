# Verification Route

- Route: `aggregation-gateway`
- Submission mode: `aggregation-kurier`
- Target chain: `Horizen EON`（链上 release）

## Contract Gate
0. `createIntent` 时必须绑定卖方 `seller`（非共享池），并写入 `deadline`；可携带 `cleanupIntentIds` 自动清理过期单。
1. `statement == leaf`（本地重建 + tuple 对齐）
2. 调用者必须是该 intent 的 `buyer`
3. `verifyProofAggregation(domainId, aggregationId, leaf, merklePath, leafCount, index) == true`
4. 执行 `depositPool.releaseWithProof(...)` 完成链上释放
5. 超时后只允许走 `cancelExpiredIntent(s)` 回收锁定额度，不再允许 release。

## Route Parity Rules
- UI 只允许 intent 绑定的 buyer 发起 release 交易。
- API 只接受 aggregation tuple 字段，不混用 direct/non-aggregation 字段。
- 合约只消费 route 对应的入参。
