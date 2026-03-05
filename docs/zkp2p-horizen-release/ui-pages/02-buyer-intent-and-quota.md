# 02 Buyer Intent + Quota Check

## Page goal
买方输入 HKD 金额并创建 intent（仅锁定额度，不立即放款）。

## Must show
- 标题：`创建买单 Intent`
- 钱包 gate：未连接禁用提交
- 额度展示：
  - `当前可兑换额度：HKD ...`
  - `对应 USDC：...`
  - `汇率固定：1 HKD = 1 USDC`
- 输入：`hkdAmount` + 只读 `requiredUSDC`
- 校验：`requiredUSDC <= availableBalance`
- CTA：`创建 Intent 并锁定额度`
- 摘要：`buyerAddress` / `chainId` / `expectedUSDCAmount`

## Data bindings
- 输入映射：`requiredUSDC = hkdAmount`
- 校验失败提示：`额度不足，无法创建 Intent`

## UX checks
- 未连接钱包、额度不足都必须禁用 CTA。
