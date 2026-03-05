# zkp2p UI 参考图生成提示词

基于 PRD（`zkp2p-deposit-pool-prd.md`）建议先生成 **8 个页面**，可覆盖完整买卖与证明放款闭环。

## 1. 卖方 Deposit 资金池总览页

```text
Design a high-fidelity desktop web app screen (1440x1024) for product "zkp2p". This is a fintech dashboard in Simplified Chinese. Visual style: premium editorial fintech, clean light background with subtle grain texture, deep navy text, emerald accents, orange warning accents, large data typography, no purple. Use modern card layout with clear hierarchy and realistic spacing.

Page goal: Seller Deposit Pool Overview.
Must show:
- Title: "zkp2p 卖方资金池"
- Four KPI cards: totalDeposited, availableBalance, reservedBalance, maxRedeemableHKD
- Explicit copy: "1 HKD = 1 USDC"
- Deposit form (USDC amount) with button "存入 Deposit 池"
- Withdraw form with rule hint: "仅可提取 availableBalance"
- Recent on-chain activity table: deposit, reserve, release, withdraw
- Status tags: healthy / low liquidity / paused
- No word "escrow" anywhere, always use "deposit pool" or "Deposit 池"
- Microcopy explaining: buyer can only consume within available balance

Generate as realistic SaaS UI mockup, not wireframe, no device frame, no 3D.
```

## 2. 买方下单与可兑换额度页

```text
Create a high-fidelity web app screen (1440x1024) for "zkp2p" in Simplified Chinese. Style: same system as previous page (light editorial fintech, navy + emerald accents).

Page goal: Buyer creates Intent with HKD input and quota check.
Must include:
- Header: "创建买单 Intent"
- Wallet gate panel: "请先连接钱包" with disabled state example and connected state badge
- Prominent quota display:
  - "当前可兑换额度：HKD 8,420"
  - "对应 USDC：8,420"
  - "汇率固定：1 HKD = 1 USDC"
- Input section: HKD amount field, computed requiredUSDC field (read-only, 1:1)
- Validation states:
  - valid: requiredUSDC <= availableBalance
  - invalid: show inline error "额度不足，无法创建 Intent"
- CTA button "创建 Intent 并锁定额度"
- Right panel summary: buyerAddress, chainId, expectedUSDCAmount
- No word "escrow"

Show polished, production-level UI reference image.
```

## 3. Intent 创建成功 + Proof 插件启动引导页

```text
Generate a high-fidelity desktop UI screen for "zkp2p" (Simplified Chinese, 1440x1024). Keep visual system consistent.

Page goal: after buyer creates intent, guide user to start proof plugin and open Wise.
Must show:
- Success banner: "Intent 已创建，额度已预占用"
- Intent card: intentId, locked amount, buyerAddress, created time
- Stepper (5 steps):
  1. Intent 已创建
  2. 启动 Proof 插件
  3. 前往 Wise 页面采集证明数据
  4. 提交 zkVerify
  5. 链上放款
- Primary CTA: "启动 Proof 插件"
- Secondary CTA: "打开 Wise 页面"
- Safety notes: browser proving only, do not close tab, data privacy hint
- Sidebar showing availableBalance and reservedBalance updated after lock
- No "escrow" wording

Make it look like a real SaaS flow page with strong conversion clarity.
```

## 4. Proof 状态追踪页（pending / verified / aggregated）

```text
Design a detailed status-tracking web app screen for "zkp2p" in Simplified Chinese (1440x1024), premium fintech style consistent with prior pages.

Page goal: Track proof lifecycle and raw backend statuses.
Must include:
- Large status timeline: pending -> verified -> aggregated
- Raw backend status text block (monospace): relay status, zkVerify status, timestamp
- Badge: activeProofId and stale-response guard hint: "仅最新 proofId 可更新状态"
- Polling indicator and refresh cadence
- Error cards for relay/verify failure with retry buttons
- Consumption stage strip:
  - aggregated_ready
  - buyer_signing
  - action_submitting
  - action_done
- Disable release action until required stage is met
- No "escrow" term

Visual should emphasize trust, traceability, and operational transparency.
```

## 5. 买方签名 + 链上验证确认页

```text
Create a high-fidelity confirmation screen for "zkp2p" (Simplified Chinese, desktop 1440x1024), same design language.

Page goal: Gate wallet signature until wallet is intent buyer and proof is aggregated.
Must show:
- Title: "放款前检查与签名"
- Gate checklist UI:
  - wallet connected
  - chain correct
  - proof aggregated_ready
  - wallet == intent buyer
- If any missing, primary button disabled with reason text
- If all pass, primary CTA: "签名并执行 releaseWithProof"
- Transaction summary card:
  - intentId
  - buyerAddress
  - amount USDC
  - HKD equivalent (1:1)
- Warning note: one-time action, replay prevented after success
- No "escrow" wording, use "Deposit 合约 release"

Generate realistic product-grade screen, not conceptual art.
```

## 6. 链上执行中页（action_submitting）

```text
Generate a transaction-in-progress UI screen for "zkp2p" in Simplified Chinese (1440x1024), same visual style.

Page goal: Show on-chain release submission and confirmation progress.
Must include:
- Main state: "正在提交链上放款"
- Progress components:
  - wallet signed
  - tx sent
  - block inclusion
  - confirmation count
- Pending transaction card with tx hash preview and explorer link button
- Live log panel (timestamped)
- Secondary actions: "复制交易哈希", "查看区块浏览器", "返回状态页"
- Context reminder: amount, buyerAddress, intentId
- No escrow wording

Make it feel operational and trustworthy, like a real fintech transaction center.
```

## 7. 放款成功结果页（action_done + 防重放）

```text
Create a high-fidelity success result screen for "zkp2p" (Simplified Chinese, 1440x1024), consistent style.

Page goal: Release succeeded, show receipt and replay guard.
Must show:
- Success hero: "放款完成"
- Receipt card:
  - intentId
  - released amount USDC
  - HKD equivalent (1:1)
  - buyerAddress
  - tx hash + explorer link
  - completion timestamp
- Replay guard UI:
  - status chip "action_done"
  - primary action disabled: "已完成，不可重复提交"
- Optional next actions:
  - "返回买单列表"
  - "下载凭证"
- No word escrow

Visual tone: confident completion, audit-ready clarity.
```

## 8. 失败与重试中心页（统一异常处理）

```text
Design an error-and-retry center screen for "zkp2p" in Simplified Chinese (1440x1024), same design system.

Page goal: Unified handling for relay failure, verification failure, and release failure.
Must include:
- Segmented tabs: "Proof Relay 错误", "zkVerify 错误", "链上放款错误"
- For each tab show:
  - error code
  - raw error text
  - probable cause
  - retry strategy
- Clear retry CTAs:
  - "重试提交 proof"
  - "重新查询 zkVerify 状态"
  - "重新发起 release"
- Safety notes:
  - keep activeProofId consistent
  - do not create duplicate intent
- Side panel with current order context (intentId, amount, buyerAddress, status)
- No "escrow" term

Generate a polished, practical operations UI reference image.
```
