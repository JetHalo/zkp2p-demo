# Proof Flow

1. 买方创建 Intent，合约预占用余额。
2. 前端拉起 proof 插件并采集 Wise 数据。
3. 浏览器本地 proving（不上传 witness）。
4. `POST /api/submit-proof` 提交 proof + binding fields。
5. `GET /api/proof-status` 轮询状态并映射 `pending/verified/aggregated`。
6. `GET /api/proof-aggregation` 获取 tuple。
7. 本地脚本确认 `statement == leaf`。
8. intent buyer 直接调用 `releaseWithProof(...)`，合约内执行 gateway 验证并放款。
