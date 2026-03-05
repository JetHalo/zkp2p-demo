# Circuit Intake - zkp2p-horizen-release

- Language: `Noir`
- Proof system: `UltraHonk`
- Mode: `aggregation-kurier`
- Route: `aggregation-gateway`
- Chain: `Horizen EON`

## Public inputs
- `businessDomain`
- `appId`
- `userAddr`
- `chainId`
- `timestamp`
- `intentId`
- `amount`
- `wiseReceiptHash`
- `nullifier`
- `statement`

## Private inputs
- `secret`
- `wiseWitnessHash`

## Notes
- statement 计算见 `docs/zkp2p-horizen-release/statement-contract.md`
- 浏览器 proving，不上传 witness 至服务端。
- 电路内部使用 `MiMC7` 进行 statement/nullifier/witness hash 约束。
- `wise_witness_hash` 绑定 `user_addr`，用于付款人一致性校验。
- `wise_witness_hash` 绑定 `wise_receipt_hash`，用于 TLS attestation 摘要一致性校验。
