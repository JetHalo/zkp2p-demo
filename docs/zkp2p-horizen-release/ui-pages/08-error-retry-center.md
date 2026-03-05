# 08 Error & Retry Center

## Page goal
统一处理 relay、zkVerify、链上放款错误。

## Must show
- 分段标签：`Proof Relay 错误` / `zkVerify 错误` / `链上放款错误`
- 每类错误展示：`errorCode` / raw text / probable cause / retry strategy
- 重试按钮：
  - `重试提交 proof`
  - `重新查询 zkVerify 状态`
  - `重新发起 release`
- 安全提示：保持 `activeProofId` 一致；不要重复创建 intent
- 侧栏上下文：`intentId` / `amount` / `buyerAddress` / current status

## Error mapping link
- 对应排障矩阵：`docs/zkp2p-horizen-release/error-matrix.md`
