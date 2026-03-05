export type VerificationMode = "aggregation-kurier";
export type ProofSystem = "ultrahonk";

export interface ProofSubmitRequest {
  proofId: string;
  verificationMode: VerificationMode;
  proofSystem: ProofSystem;
  proof: string;
  publicInputs: string[];
  appId: string;
  businessDomain: string;
  aggregationDomainId: string;
  userAddr: string;
  chainId: number;
  timestamp: number;
  intentId: string;
  intentHash: string;
  amount: string;
  wiseReceiptHash: string;
  nullifier: string;
}

export interface ProofStatusResponse {
  proofId: string;
  status: "pending" | "verified" | "aggregated" | string;
  rawStatus: string;
  updatedAt: string;
  source: "kurier-keyed" | "kurier-public";
  availableKeys: string[];
  providerJobId?: string;
  intentHash?: string;
  nullifier?: string;
  error?: string;
  details?: string[];
}

export interface ProofAggregationTuple {
  proofId: string;
  aggregationDomainId: string;
  aggregationId: string;
  leafCount: string;
  index: string;
  leaf: string;
  merklePath: string[];
  intentHash?: string;
  nullifier?: string;
}

export interface ReleaseCheckSnapshot {
  proofId: string;
  intentHash: string;
  leaf: string;
  verificationReady: boolean;
  aggregationDomainId: string;
  aggregationId: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSubmitRequest(payload: unknown): ValidationResult {
  const errors: string[] = [];
  const p = payload as Partial<ProofSubmitRequest>;

  if (!p || typeof p !== "object") {
    return { ok: false, errors: ["payload must be an object"] };
  }

  const requiredStringFields: Array<keyof ProofSubmitRequest> = [
    "proofId",
    "proof",
    "appId",
    "businessDomain",
    "aggregationDomainId",
    "userAddr",
    "intentId",
    "intentHash",
    "amount",
    "wiseReceiptHash",
    "nullifier"
  ];

  for (const field of requiredStringFields) {
    if (!p[field] || typeof p[field] !== "string") {
      errors.push(`${field} must be a non-empty string`);
    }
  }

  if (p.verificationMode !== "aggregation-kurier") {
    errors.push("verificationMode must be aggregation-kurier");
  }

  if (p.proofSystem !== "ultrahonk") {
    errors.push("proofSystem must be ultrahonk");
  }

  if (!Array.isArray(p.publicInputs)) {
    errors.push("publicInputs must be an array of strings");
  }

  if (typeof p.chainId !== "number") {
    errors.push("chainId must be a number");
  }

  if (typeof p.timestamp !== "number") {
    errors.push("timestamp must be a number");
  }

  return { ok: errors.length === 0, errors };
}
