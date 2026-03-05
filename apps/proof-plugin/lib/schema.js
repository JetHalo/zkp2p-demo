import { PROOF_SYSTEM, VERIFICATION_MODE } from "./constants.js";

const requiredString = [
  "proofId",
  "intentId",
  "intentHash",
  "proverSecret",
  "buyerAddress",
  "amount",
  "businessDomain",
  "aggregationDomainId",
  "appId",
  "nullifier",
  "submitEndpoint",
  "statusEndpoint",
  "aggregationEndpoint",
  "wiseAttestationEndpoint"
];

export function validateStartPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: ["payload must be object"] };
  }

  for (const key of requiredString) {
    if (!payload[key] || typeof payload[key] !== "string") {
      errors.push(`${key} must be a non-empty string`);
    }
  }

  if (payload.verificationMode !== VERIFICATION_MODE) {
    errors.push(`verificationMode must be ${VERIFICATION_MODE}`);
  }

  if (payload.proofSystem !== PROOF_SYSTEM) {
    errors.push(`proofSystem must be ${PROOF_SYSTEM}`);
  }

  if (typeof payload.chainId !== "number") {
    errors.push("chainId must be a number");
  }

  if (typeof payload.timestamp !== "number") {
    errors.push("timestamp must be a number");
  }

  if (!Array.isArray(payload.publicInputs)) {
    errors.push("publicInputs must be string[]");
  }

  if (payload.buyerAddress && !payload.buyerAddress.startsWith("0x")) {
    errors.push("buyerAddress must be hex address");
  }

  return { ok: errors.length === 0, errors };
}

export function validateMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }
  return typeof message.type === "string";
}
