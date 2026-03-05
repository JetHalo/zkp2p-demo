# Threat Model

| Threat | Boundary | Mitigation |
| --- | --- | --- |
| Stale proof 回写覆盖最新状态 | Browser/API | activeProofId 检查 |
| nullifier 重放 | Contract | `nullifierUsed` mapping |
| API key 泄漏 | Server | 禁止 NEXT_PUBLIC 前缀，运行时注入 |
| route 混用导致错误放款 | API/Contract | 固定 mode + route 文件锁 |
| domain 字段语义混淆 | Cross-layer | `businessDomain`/`aggregationDomainId` 显式分离 |
