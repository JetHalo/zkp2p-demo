# UX Flow

Detailed page-level specs: `docs/zkp2p-horizen-release/ui-pages/README.md`

## Proof lifecycle
`pending -> verified -> aggregated`

## Consume lifecycle
`aggregated_ready -> buyer_signing -> action_submitting -> action_done`

## Gating
- 未连接钱包时禁用 prove/release。
- 非 intent buyer 时禁用 release 签名按钮。
- action_done 后禁用重复提交。
- 仅 `activeProofId` 可更新当前页面状态。
