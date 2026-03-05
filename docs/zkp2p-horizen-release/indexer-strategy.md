# Indexer Strategy Lock

- Case: `zkp2p-horizen-release`
- Locked at: `2026-02-09`
- Value: `thegraph`
- Status: `confirmed-by-user`

## Why thegraph
- 你已明确要求使用 The Graph。
- 读取 commitments/history 更适合走子图查询，前端响应更快。

## Fallback / Upgrade
- 当前策略：Graph first, sqlite fallback（API 内部降级）。
- 若未来切 `hybrid`，仅需把 fallback 策略文档升级为双向切流。
