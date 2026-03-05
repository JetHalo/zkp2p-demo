# 04 Proof Status Tracking

## Page goal
可观测展示 proof 生命周期与后端原始状态。

## Must show
- 时间线：`pending -> verified -> aggregated`
- 原始状态块（monospace）：relay/zkVerify/timestamp
- `activeProofId` 标识 + stale guard 文案
- 轮询指示与刷新频率
- relay/verify 失败卡片 + 重试按钮
- consume stage 条：
  - aggregated_ready
  - buyer_signing
  - action_submitting
  - action_done

## Data bindings
- 状态来源：`GET /api/proof-status`
- stale 规则：仅 `proofId == activeProofId` 可更新 UI。

## UX checks
- status 文本不能直接当 finalize gate。
