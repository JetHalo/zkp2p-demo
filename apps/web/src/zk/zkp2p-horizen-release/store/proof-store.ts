import type { ProofStatusResponse, ProofAggregationTuple } from "../schemas";

const nullifierSet = new Set<string>();
const wiseReceiptHashSet = new Set<string>();
const statusByProofId = new Map<string, ProofStatusResponse>();
const statusByProviderJobId = new Map<string, ProofStatusResponse>();
const tupleByProofId = new Map<string, ProofAggregationTuple>();

export function reserveNullifier(nullifier: string): boolean {
  if (nullifierSet.has(nullifier)) {
    return false;
  }
  nullifierSet.add(nullifier);
  return true;
}

export function releaseNullifier(nullifier: string): void {
  nullifierSet.delete(nullifier);
}

export function reserveWiseReceiptHash(wiseReceiptHash: string): boolean {
  if (wiseReceiptHashSet.has(wiseReceiptHash)) {
    return false;
  }
  wiseReceiptHashSet.add(wiseReceiptHash);
  return true;
}

export function releaseWiseReceiptHash(wiseReceiptHash: string): void {
  wiseReceiptHashSet.delete(wiseReceiptHash);
}

export function upsertStatus(status: ProofStatusResponse): void {
  statusByProofId.set(status.proofId, status);
  if (status.providerJobId) {
    statusByProviderJobId.set(status.providerJobId, status);
  }
}

export function getStatus(proofId: string): ProofStatusResponse | undefined {
  return statusByProofId.get(proofId) ?? statusByProviderJobId.get(proofId);
}

export function upsertTuple(tuple: ProofAggregationTuple): void {
  tupleByProofId.set(tuple.proofId, tuple);
}

export function getTuple(proofId: string): ProofAggregationTuple | undefined {
  return tupleByProofId.get(proofId);
}
