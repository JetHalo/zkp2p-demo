export type ProofStatus = "pending" | "verified" | "aggregated";

export type ConsumeStage =
  | "aggregated_ready"
  | "buyer_signing"
  | "action_submitting"
  | "action_done";

export interface ProofUiState {
  activeProofId: string | null;
  proofStatus: ProofStatus;
  consumeStage: ConsumeStage;
  rawStatus: string;
  walletConnected: boolean;
  buyerReady: boolean;
}

export function canPromptReleaseWallet(state: ProofUiState): boolean {
  return (
    state.walletConnected &&
    state.proofStatus === "aggregated" &&
    state.consumeStage === "buyer_signing" &&
    state.buyerReady
  );
}

export function shouldIgnoreIncomingProof(
  activeProofId: string | null,
  incomingProofId: string
): boolean {
  return !activeProofId || activeProofId !== incomingProofId;
}

export type ProofAction =
  | { type: "wallet"; connected: boolean }
  | { type: "new-proof"; proofId: string }
  | { type: "proof-status"; proofId: string; status: ProofStatus; rawStatus: string }
  | { type: "buyer-ready"; ok: boolean }
  | { type: "consume-stage"; stage: ConsumeStage };

export function reduceProofState(state: ProofUiState, action: ProofAction): ProofUiState {
  switch (action.type) {
    case "wallet":
      return { ...state, walletConnected: action.connected };
    case "new-proof":
      return {
        ...state,
        activeProofId: action.proofId,
        proofStatus: "pending",
        consumeStage: "aggregated_ready",
        buyerReady: false
      };
    case "proof-status":
      if (shouldIgnoreIncomingProof(state.activeProofId, action.proofId)) {
        return state;
      }
      return { ...state, proofStatus: action.status, rawStatus: action.rawStatus };
    case "buyer-ready":
      return {
        ...state,
        buyerReady: action.ok,
        consumeStage: action.ok ? "buyer_signing" : "aggregated_ready"
      };
    case "consume-stage":
      return { ...state, consumeStage: action.stage };
    default:
      return state;
  }
}
