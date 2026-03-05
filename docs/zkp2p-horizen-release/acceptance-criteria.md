# Acceptance Criteria

1. Proving 在浏览器完成，服务端不接收 witness。
2. `pages/api/submit-proof.ts` 与 `pages/api/proof-status.ts` 存在并可用。
3. aggregation 路径必须提供 `pages/api/proof-aggregation.ts`。
4. `businessDomain` 与 `aggregationDomainId` 字段严格分离。
5. `statement == leaf` 校验可由脚本复现。
6. 链上 release 前必须 `verifyProofAggregation(domainId, aggregationId, leaf, merklePath, leafCount, index) == true`。
7. 合约 release 只能执行一次，同 `nullifier` 二次调用会 revert。
8. Intent release 目标地址来自链上 intent 记录，不可在 release 时篡改。
9. Intent 必须绑定 seller，release 只可消耗该 seller 的质押余额。
10. UI 必须展示 `pending/verified/aggregated` 以及 raw status。
11. UI 必须只允许 intent buyer 发起 `releaseWithProof(...)` 钱包签名。
12. 索引器增量同步，不允许每次从 genesis 全扫。
13. 文档包含 `symptom -> root cause -> shortest command` 错误矩阵。
14. 买方必须可直接调用 `createIntent(...)` 锁定额度，不依赖 operator 热路径。
15. intent 必须有 `deadline`，超时后可通过 `cancelExpiredIntent(s)` 按需回收，无需定时频繁调用。
