# Plugin Integration (Standalone Folder)

插件目录：`apps/proof-plugin`

## PRD 对齐顺序
1. dApp 创建 intent（锁定额度）
2. dApp 调 `window.zkp2pProofPlugin.startProof(...)`
3. 插件拉起 Wise 页面并执行 TLSNotary 采集
4. 插件提交 attestation 到 `POST /api/verify-wise-attestation`
5. 插件获取 `wiseReceiptHash` 后在浏览器内 proving
6. 插件提交 proof 到 `POST /api/submit-proof`
7. 插件查询 `GET /api/proof-status`
8. 插件查询 `GET /api/proof-aggregation`
9. dApp 由 intent buyer 发起 `releaseWithProof(...)`（交易内校验 aggregation）

## dApp 可调用接口
- `startProof(payload)`
- `captureFromActiveTab(proofId)`
- `runProving(proofId)`
- `submitProof(proofId)`
- `queryStatus(proofId)`
- `queryAggregation(proofId)`
- `getSession(proofId)`
- `resetSession(proofId)`

## Status 回传
插件会发出 DOM 事件：`zkp2p-plugin-status`
- detail: `{ proofId, status, detail, ts }`
- status: `wise_opened | capture_ready | proving | proof_ready | submitted | verified | aggregated | error`

## Required payload fields
- `proofId`, `intentId`, `buyerAddress`, `amount`
- `businessDomain`, `aggregationDomainId`, `appId`
- `chainId`, `timestamp`, `nullifier`
- `verificationMode` (`aggregation-kurier`)
- `proofSystem` (`ultrahonk`)
- `submitEndpoint`, `statusEndpoint`, `aggregationEndpoint`
- `wiseAttestationEndpoint`（`/api/verify-wise-attestation`）
- `tlsnPluginUrl`（TLSNotary plugin URL）
