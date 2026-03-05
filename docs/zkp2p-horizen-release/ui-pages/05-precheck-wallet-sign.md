# 05 Buyer Sign + On-chain Verify

## Page goal
仅允许 intent buyer 发起签名放款，校验在链上交易内完成。

## Must show
- 标题：`放款前检查与签名`
- 检查项：
  - wallet connected
  - chain correct
  - proof aggregated_ready
  - wallet == intent.buyer
- 缺一项即禁用主按钮并给出原因
- 全通过后显示：`签名并执行 releaseWithProof`
- 交易摘要：`intentId` / `buyerAddress` / `amount USDC` / HKD 对应值
- 风险提示：one-time action，防重放

## Gate contract
- route = aggregation-kurier 时，必须走 `releaseWithProof(...)`。
- 禁止非 buyer 地址发起签名弹窗。
