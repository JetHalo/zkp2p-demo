# Contract Notes

## Core methods
- `deposit(uint256 amount)`
- `createIntent(bytes32 intentId, address seller, uint256 amount, uint256 deadline, bytes32 nullifierHash, bytes32 statement)`
- `createIntent(bytes32 intentId, address seller, uint256 amount, uint256 deadline, bytes32 nullifierHash, bytes32 statement, bytes32[] cleanupIntentIds)`
- `releaseWithProof(bytes32 intentId, bytes32 nullifierHash, uint256 domainId, uint256 aggregationId, bytes32 leaf, bytes32[] merklePath, uint256 leafCount, uint256 index)`
- `cancelExpiredIntent(bytes32 intentId)`
- `cancelExpiredIntents(bytes32[] intentIds)`
- `withdraw(uint256 amount)`

## zkVerify gateway binding
- 使用 zkVerify 官方 `verifyProofAggregation(...)` 6 参数接口（建议接 Proxy 地址）。
- `leaf` 必须与 intent 预留的 `statement` 一致，否则 `StatementMismatch` 回滚。

## Key invariants
- `availableBalance + reservedBalance <= totalDeposited`
- intent 必须绑定 `seller`，释放时只消耗该 seller 的质押额度
- release 前 intent 必须处于 reserved
- `createIntent` 调用者自动作为 `intent.buyer`
- `deadline` 必须大于当前区块时间
- `createIntent(..., cleanupIntentIds)` 会先尝试清理同 seller 的过期 intent，再执行锁单
- `releaseWithProof` 必须由 intent 绑定的 `buyer` 调用
- `verifyProofAggregation(...)` 在 release 交易内返回 `true`
- nullifier 只可使用一次
- release 接收地址固定为 createIntent 时记录的 buyer
- 过期 intent 只能取消，不可再 release

## Events
- `Deposited`
- `IntentReserved`
- `Released`
- `IntentCancelled`
- `Withdrawn`
