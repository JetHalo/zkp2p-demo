# Circuit I/O

## Public inputs
- `businessDomain: Field`
- `appId: Field`
- `userAddr: Field`
- `chainId: Field`
- `timestamp: Field`
- `intentId: Field`
- `amount: Field`
- `wiseReceiptHash: Field`
- `nullifier: Field`
- `statement: Field`

## Private inputs
- `secret: Field`
- `wiseWitnessHash: Field`

## Rules
- 公私输入必须固定顺序编码。
- `nullifier` 用于 anti-replay。
- `statement` 必须可被脚本重建并与 tuple leaf 对齐。
- 浏览器 prover backend 锁定为 `ultrahonk`。
- `statement/nullifier/wiseWitnessHash` 在电路内均通过 `MiMC7` 关系重建并强校验。
- `wiseWitnessHash` 额外绑定 `userAddr`，防止“付款人字段替换”。
- `wiseWitnessHash` 额外绑定 `wiseReceiptHash`，保证 TLS 取证摘要被电路约束。
