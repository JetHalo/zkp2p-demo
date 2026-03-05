# Statement Contract

- Version: `mimc7-v1-ordered-fold-ultrahonk`
- Proof system lock: `UltraHonk`
- Formula:

```txt
fd_businessDomain = string_to_field_utf8(businessDomain)
fd_appId = string_to_field_utf8(appId)
fd_userAddr = hex_to_field(userAddr)
fd_intentId = hex_to_field(intentId)

acc0 = mimc7_hash2(fd_intentId, fd_userAddr)
acc1 = mimc7_hash2(acc0, amount)
acc2 = mimc7_hash2(acc1, chainId)
acc3 = mimc7_hash2(acc2, timestamp)
acc4 = mimc7_hash2(acc3, fd_businessDomain)
statement = mimc7_hash2(acc4, fd_appId)
```

- `mimc7_hash2(left, right) = mimc7_permute(left, right) + right`
- `mimc7_permute` 固定 91 rounds，round constant = `1..91`
- 输出为 32-byte hex（小写，`0x` 前缀）。
- 所有层（UI/API/scripts/circuit）必须使用同一顺序。
