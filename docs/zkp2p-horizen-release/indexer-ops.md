# Indexer Ops (The Graph)

## Strategy
- Graph first: 所有 commitments/history 默认走 Subgraph。
- API fallback: 当 Subgraph 不可用时降级到 sqlite。

## Run
```bash
curl -sS "$THEGRAPH_SUBGRAPH_URL" \
  -H 'content-type: application/json' \
  --data '{"query":"{ commitments(first: 20, orderBy: blockNumber, orderDirection: desc) { intentId buyer amount txHash blockNumber createdAt } }"}'
```

## Recovery
- 子图延迟: 降级 sqlite 并记录 lag。
- 子图 5xx: 自动 fallback 并报警。
- 查询 schema 变化: 对齐 query 字段后重试。
