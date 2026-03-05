# 01 Seller Deposit Pool Overview

## Page goal
卖方查看资金池健康度并执行 `deposit/withdraw`。

## Must show
- 标题：`zkp2p 卖方资金池`
- KPI: `totalDeposited` / `availableBalance` / `reservedBalance` / `maxRedeemableHKD`
- 汇率文案：`1 HKD = 1 USDC`
- Deposit 表单（USDC）+ `存入 Deposit 池`
- Withdraw 表单 + 提示 `仅可提取 availableBalance`
- 链上活动表：deposit/reserve/release/withdraw
- 状态标签：healthy / low liquidity / paused

## Data bindings
- 合约读：`totalDeposited`, `availableBalance`, `reservedBalance`
- 派生：`maxRedeemableHKD = availableBalance`

## UX checks
- 当 `availableBalance = 0` 时禁用买方可兑换入口。
- 不出现 `escrow` 术语。
