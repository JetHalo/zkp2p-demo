# Noir Input Schema

## Public
- `business_domain`
- `app_id`
- `user_addr`
- `chain_id`
- `timestamp`
- `intent_id`
- `amount`
- `wise_receipt_hash`
- `nullifier`
- `statement`

## Private
- `secret`
- `wise_witness_hash`

## Constraints
- 所有 public/private 输入都必须为非零字段。
- `statement` 必须等于同序 `MiMC7` 折叠结果：
  `intent_id -> user_addr -> amount -> chain_id -> timestamp -> business_domain -> app_id`。
- `nullifier` 必须等于 `mimc7_hash2(secret, intent_id)`（anti-replay 绑定）。
- `wise_witness_hash` 必须等于
  `mimc7_hash2(mimc7_hash2(mimc7_hash2(mimc7_hash2(amount, timestamp), user_addr), wise_receipt_hash), secret)`。
