# zkp2p Horizen Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 基于 PRD 实现一个“插件聚合 + zkVerify + Horizen 链上 release”的可执行项目骨架，覆盖文档、API、电路、合约、UI 状态机、索引器。

**Architecture:** 采用 `aggregation-kurier` 路线。前端浏览器本地 proving；Next.js API 做 proof relay/status/aggregation tuple；Foundry 合约实现 deposit/reserve/releaseWithProof/withdraw；thegraph 查询 commitments 与 intent 历史（sqlite 仅 fallback）。

**Tech Stack:** TypeScript, Next.js Pages Router, Solidity (Foundry), Noir (circuit intake), SQLite.

### Task 1: Stage 0.5 决策锁定与验收

**Files:**
- Create: `docs/zkp2p-horizen-release/task-list.md`
- Create: `docs/zkp2p-horizen-release/acceptance-criteria.md`
- Create: `docs/zkp2p-horizen-release/submission-mode.md`
- Create: `docs/zkp2p-horizen-release/verification-route.md`
- Create: `docs/zkp2p-horizen-release/schema-decisions.md`
- Create: `docs/zkp2p-horizen-release/indexer-strategy.md`
- Create: `docs/zkp2p-horizen-release/decision-locks.md`
- Create: `docs/zkp2p-horizen-release/error-matrix.md`
- Create: `docs/zkp2p-horizen-release/runbook.md`

**Step 1: 写出明确锁定值与拒绝方案**
- submission mode: `aggregation-kurier`
- verification route: `aggregation-gateway`
- indexer: `thegraph`（已由用户确认）

**Step 2: 按 Stage 0.5 -> 7 输出任务与 gate**
- 包含 route parity、statement parity、buyer release gate。

**Step 3: 定义错误矩阵与最短排查命令**
- 包含 `zkverify invalid`、mode mismatch、domain mismatch、429/eth_getLogs。

### Task 2: TDD 先行 - 合约测试再实现

**Files:**
- Create: `contracts/test/Zkp2pDepositPool.t.sol`
- Create: `contracts/src/Zkp2pDepositPool.sol`

**Step 1: 先写失败测试**
- deposit 增加 available
- createIntent 锁定额度
- releaseWithProof 单次执行 + nullifier 防重放
- deadline 超时取消回收额度
- withdraw 仅允许空闲余额

**Step 2: 再写最小实现代码**
- `deposit/createIntent/releaseWithProof/cancelExpiredIntent/withdraw`

### Task 3: API + schema + UI 状态机

**Files:**
- Create: `apps/web/pages/api/submit-proof.ts`
- Create: `apps/web/pages/api/proof-status.ts`
- Create: `apps/web/pages/api/proof-aggregation.ts`
- Create: `apps/web/pages/api/commitments.ts`
- Create: `apps/web/src/zk/zkp2p-horizen-release/schemas.ts`
- Create: `apps/web/src/zk/zkp2p-horizen-release/state-machine.ts`
- Create: `apps/web/pages/zkp2p-horizen-release.tsx`

**Step 1: mode-safe payload builder**
- 分离 `businessDomain` 与 `aggregationDomainId`。

**Step 2: API 边界**
- server-only key，校验 anti-replay 与 binding。

**Step 3: UI gate**
- `pending -> verified -> aggregated`
- `aggregated_ready -> buyer_signing -> action_submitting -> action_done`

### Task 4: 电路 intake 与 statement 脚本

**Files:**
- Create: `circuits/zkp2p-horizen-release/INTAKE.md`
- Create: `circuits/zkp2p-horizen-release/noir/src/main.nr`
- Create: `scripts/zkp2p-horizen-release/check-statement.ts`

**Step 1: 明确 public/private 输入切分**
**Step 2: 实现 statement 重建脚本（与叶子对比）**

### Task 5: The Graph 索引器与运行手册

**Files:**
- Create: `scripts/zkp2p-horizen-release/thegraph/subgraph.yaml`
- Create: `scripts/zkp2p-horizen-release/thegraph/schema.graphql`
- Create: `scripts/zkp2p-horizen-release/thegraph/src/mapping.ts`
- Create: `scripts/zkp2p-horizen-release/query-subgraph.ts`
- Create: `docs/zkp2p-horizen-release/indexer-ops.md`
- Create: `docs/zkp2p-horizen-release/troubleshooting.md`

**Step 1: 构建 Subgraph schema/mapping/manifest**
**Step 2: Graph-first 查询 + fallback 策略验证**
