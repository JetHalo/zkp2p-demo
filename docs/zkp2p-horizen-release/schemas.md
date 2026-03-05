# Schemas

## ProofSubmitRequest
- `proofId: string`
- `verificationMode: "aggregation-kurier"`
- `proof: string`
- `publicInputs: string[]`
- `appId: string`
- `businessDomain: string`
- `aggregationDomainId: string`
- `userAddr: string`
- `chainId: number`
- `timestamp: number`
- `intentId: string`
- `amount: string`
- `nullifier: string`

## ProofStatusResponse
- `proofId: string`
- `status: "pending" | "verified" | "aggregated" | string`
- `rawStatus: string`
- `updatedAt: string`
- `source: "kurier-keyed" | "kurier-public"`
- `availableKeys: string[]`

## ProofAggregationTuple
- `proofId: string`
- `aggregationDomainId: string`
- `aggregationId: string`
- `leafCount: string`
- `index: string`
- `leaf: string`
- `merklePath: string[]`

## ReleaseCheckSnapshot
- `proofId: string`
- `statement: string`
- `leaf: string`
- `verificationReady: boolean`
- `aggregationDomainId: string`
- `aggregationId: string`
