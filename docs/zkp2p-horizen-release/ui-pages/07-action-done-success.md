# 07 Action Done + Replay Guard

## Page goal
放款成功后给出可审计凭证，并阻止重复提交。

## Must show
- 成功头图：`放款完成`
- 回执：`intentId` / released USDC / HKD / `buyerAddress` / `txHash` / completion time
- 防重放：`action_done` 状态 chip
- 主按钮禁用：`已完成，不可重复提交`
- 次操作：返回买单列表 / 下载凭证

## Data bindings
- 成功状态来自链上确认结果。
- nullifier 使用状态可选展示（只读）。
