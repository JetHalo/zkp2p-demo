export interface CommitmentRow {
  id: number;
  intentId: string;
  buyer: string;
  amount: string;
  txHash: string;
  blockNumber: number;
  createdAt: string;
}

// Fallback path for The Graph outages. Real sqlite wiring lives in scripts.
export async function readRecentCommitments(_limit: number): Promise<CommitmentRow[]> {
  return [];
}
