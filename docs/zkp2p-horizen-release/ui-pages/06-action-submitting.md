# 06 On-chain Submitting

## Page goal
展示链上放款交易提交与确认进度。

## Must show
- 主状态：`正在提交链上放款`
- 进度点：wallet signed / tx sent / included / confirmations
- 待确认卡：`txHash` + explorer 按钮
- 时间日志面板（timestamped）
- 次操作：复制哈希 / 查看浏览器 / 返回状态页
- 上下文：`intentId` / `buyerAddress` / `amount`

## Data bindings
- tx 状态来自钱包回执 + RPC 轮询。
- 失败跳转到统一错误中心（Page 08）。
