# Error Matrix

| Symptom | Root cause | Shortest command |
| --- | --- | --- |
| `zkverify invalid` | statement 顺序/编码不一致 | `node scripts/zkp2p-horizen-release/check-statement.ts` |
| `Aggregation domainId mismatch` | `businessDomain` 与 `aggregationDomainId` 混用 | `rg -n "businessDomain|aggregationDomainId|DOMAIN" apps/web docs` |
| `INVALID_SUBMISSION_MODE_ERROR` | API payload 与 mode 不匹配 | `rg -n "verificationMode|proofOptions|aggregation" apps/web/pages/api` |
| release tx revert `NullifierAlreadyUsed` | 重放调用 | `cast call <pool> "nullifierUsed(bytes32)(bool)" <nullifier>` |
| release tx revert `IntentNotReserved` | createIntent/release 顺序错误，或 intent 已被取消 | `cast call <pool> "getIntent(bytes32)((address,address,uint256,uint256,bool,bool,bool,bytes32,bytes32))" <intentId>` |
| release tx revert `OnlyIntentBuyer` | 当前签名钱包不是 intent 绑定 buyer | `cast call <pool> "getIntent(bytes32)((address,address,uint256,uint256,bool,bool,bool,bytes32,bytes32))" <intentId>` |
| release tx revert `IntentExpired` | 已超过 deadline，需先取消过期 intent | `cast call <pool> "getIntent(bytes32)((address,address,uint256,uint256,bool,bool,bool,bytes32,bytes32))" <intentId>` |
| release tx revert `VerificationFailed` | gateway 返回 false（tuple/路由/域错误） | `cast call <gateway> "verifyProofAggregation(uint256,uint256,bytes32,bytes32[],uint256,uint256)(bool)" <domainId> <aggregationId> <leaf> <merklePath> <leafCount> <index>` |
| cancel tx revert `IntentNotExpired` | 未到 deadline，不能取消 | `cast call <pool> "getIntent(bytes32)((address,address,uint256,uint256,bool,bool,bool,bytes32,bytes32))" <intentId>` |
| Subgraph timeout / 5xx | The Graph 不可用或延迟 | `curl -sS \"$THEGRAPH_SUBGRAPH_URL\" -H 'content-type: application/json' --data '{\"query\":\"{ _meta { block { number } } }\"}'` |
