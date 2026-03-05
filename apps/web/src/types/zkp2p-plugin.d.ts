export {};

declare global {
  interface Window {
    zkp2pProofPlugin?: {
      startProof: (payload: Record<string, unknown>) => Promise<any>;
      captureFromActiveTab: (proofId: string) => Promise<any>;
      runProving: (proofId: string) => Promise<any>;
      submitProof: (proofId: string) => Promise<any>;
      queryStatus: (proofId: string) => Promise<any>;
      queryAggregation: (proofId: string) => Promise<any>;
      getSession: (proofId?: string) => Promise<any>;
      resetSession: (proofId: string) => Promise<any>;
    };
  }
}
