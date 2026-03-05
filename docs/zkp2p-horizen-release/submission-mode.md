# Submission Mode Lock

- Case: `zkp2p-horizen-release`
- Locked at: `2026-02-09`
- Value: `aggregation-kurier`
- Evidence: 用户需求中明确“插件 聚合 在 horizen 链上释放代币”。

## Why this mode
- 需要 proof 插件 + 聚合后再链上 release。
- 与 PRD 中 `proof -> zkVerify -> buyer releaseWithProof(intentId, tuple...)` 路径一致。

## Rejected
- `kurier-direct`: 不满足“聚合”要求。
- `zkverifyjs-non-aggregation`: 不满足“聚合 tuple + gateway releaseWithProof”路径。
