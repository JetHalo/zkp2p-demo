# Goldsky Subgraph Deployment (Horizen)

## Files
- Manifest: `scripts/zkp2p-horizen-release/thegraph/subgraph.yaml`
- Schema: `scripts/zkp2p-horizen-release/thegraph/schema.graphql`
- Mapping: `scripts/zkp2p-horizen-release/thegraph/src/mapping.ts`

## Deployment mode (fixed)
- 本项目固定使用“本地 subgraph 工程 + Goldsky CLI”发布。
- 不使用 Goldsky 网页弹窗生成子图（避免 schema/mapping 与项目代码不一致）。
- ABI 来源固定为：`scripts/zkp2p-horizen-release/thegraph/abis/Zkp2pDepositPool.json`。

## Suggested commands
```bash
# 1) 注册并登录 Goldsky（需账号）
# https://app.goldsky.com

# 2) 安装 Goldsky CLI
curl https://goldsky.com | sh

# 3) 登录（粘贴 API key）
goldsky login

# 4) 准备 manifest（从合约地址/部署块自动写入）
cd scripts/zkp2p-horizen-release/thegraph
DEPOSIT_POOL_ADDRESS=0x9e7F3e43b4bDf10edDC643e06De84Ced41093F7B \
DEPOSIT_POOL_START_BLOCK=9115726 \
SUBGRAPH_NETWORK=horizen-testnet \
npm run prepare:manifest

# 5) 生成/构建
npm i
npm run codegen
npm run build

# 6) 部署到 Goldsky
GOLDSKY_SUBGRAPH_NAME=zkp2p-horizen-release \
GOLDSKY_SUBGRAPH_VERSION=v1 \
npm run deploy:goldsky
```

## Goldsky GraphQL endpoint format
```text
https://api.goldsky.com/api/public/<project_id>/subgraphs/zkp2p-horizen-release/v1/gn
```

## Post-deploy verification
```bash
THEGRAPH_SUBGRAPH_URL=<your-url> node scripts/zkp2p-horizen-release/query-subgraph.ts 20
curl -sS "http://localhost:3000/api/commitments?limit=20"
```

Expected: `/api/commitments` 返回 `strategy: "thegraph"` 且 `fallbackUsed: false`。
