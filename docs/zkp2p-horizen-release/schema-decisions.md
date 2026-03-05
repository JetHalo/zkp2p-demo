# Schema Decisions

## Naming split (hard rule)
- `businessDomain`: 业务域绑定（proof public inputs）
- `aggregationDomainId`: zkVerify 聚合域
- 禁止复用单一字段 `DOMAIN`

## Required cross-layer fields
- `verificationMode`: `aggregation-kurier`
- `appId`: string
- `businessDomain`: string
- `aggregationDomainId`: string
- `userAddr`: address string
- `chainId`: number
- `timestamp`: number (unix seconds)
- `nullifier`: bytes32 string
- `intentId`: bytes32 string
- `amount`: uint256 string

## Statement contract
- Algorithm: `keccak-v1-ordered-packed`
- Ordered inputs:
  1. `intentId`
  2. `userAddr`
  3. `amount`
  4. `chainId`
  5. `timestamp`
  6. `businessDomain`
  7. `appId`
- Encoding: Solidity packed bytes
- Byte order: EVM canonical big-endian for integers
