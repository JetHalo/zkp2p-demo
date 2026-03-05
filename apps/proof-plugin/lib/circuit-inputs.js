const FIELD_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const MIMC_ROUNDS = 91;

function mod(v) {
  const r = v % FIELD_MODULUS;
  return r >= 0n ? r : r + FIELD_MODULUS;
}

function pow7(x) {
  const x2 = mod(x * x);
  const x4 = mod(x2 * x2);
  return mod(x4 * x2 * x);
}

function mimc7Permute(input, key) {
  let state = mod(input);
  const k = mod(key);
  for (let i = 0; i < MIMC_ROUNDS; i += 1) {
    state = pow7(mod(state + k + BigInt(i + 1)));
  }
  return mod(state + k);
}

function mimc7Hash2(left, right) {
  const r = mod(right);
  return mod(mimc7Permute(left, r) + r);
}

function fieldToHex32(value) {
  return `0x${mod(value).toString(16).padStart(64, "0")}`;
}

function stringToField(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let out = 0n;
  for (const byte of bytes) {
    out = mod(out * 256n + BigInt(byte));
  }
  return out;
}

function parseField(value, fieldName) {
  if (typeof value === "bigint") return mod(value);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return mod(BigInt(Math.trunc(value)));
  }
  if (typeof value === "string") {
    const v = value.trim();
    if (!v) throw new Error(`${fieldName} is empty`);
    if (/^0x[0-9a-fA-F]+$/.test(v)) return mod(BigInt(v));
    if (/^[0-9]+$/.test(v)) return mod(BigInt(v));
  }
  throw new Error(`${fieldName} is not a valid field integer`);
}

function normalizeHex32(value, fieldName) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.trim())) {
    throw new Error(`${fieldName} must be 0x + 32-byte hex`);
  }
  return value.trim().toLowerCase();
}

function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value.trim())) {
    throw new Error("buyerAddress must be 0x + 20-byte hex");
  }
  return value.trim().toLowerCase();
}

function computeStatement({
  businessDomainField,
  appIdField,
  userAddrField,
  chainIdField,
  timestampField,
  intentIdField,
  amountField
}) {
  let acc = mimc7Hash2(intentIdField, userAddrField);
  acc = mimc7Hash2(acc, amountField);
  acc = mimc7Hash2(acc, chainIdField);
  acc = mimc7Hash2(acc, timestampField);
  acc = mimc7Hash2(acc, businessDomainField);
  return mimc7Hash2(acc, appIdField);
}

function computeNullifier(secretField, intentIdField) {
  return mimc7Hash2(secretField, intentIdField);
}

function computeWiseWitnessHash({
  amountField,
  timestampField,
  userAddrField,
  wiseReceiptHashField,
  secretField
}) {
  const paymentCommitment = mimc7Hash2(amountField, timestampField);
  const payerCommitment = mimc7Hash2(paymentCommitment, userAddrField);
  const receiptCommitment = mimc7Hash2(payerCommitment, wiseReceiptHashField);
  return mimc7Hash2(receiptCommitment, secretField);
}

export function deriveCircuitInputs(session) {
  if (!session || typeof session !== "object") {
    throw new Error("session is required");
  }

  const businessDomainText = String(session.businessDomain || "").trim();
  const appIdText = String(session.appId || "").trim();
  if (!businessDomainText) throw new Error("businessDomain missing");
  if (!appIdText) throw new Error("appId missing");

  const buyerAddressHex = normalizeAddress(session.buyerAddress);
  const intentIdHex = normalizeHex32(session.intentId, "intentId");
  const intentHashHex = normalizeHex32(session.intentHash || session.intentId, "intentHash");
  const wiseReceiptHashHex = normalizeHex32(session.wiseReceiptHash, "wiseReceiptHash");
  const secretField = parseField(session.proverSecret, "proverSecret");
  if (secretField === 0n) {
    throw new Error("proverSecret cannot be zero");
  }

  const businessDomainField = stringToField(businessDomainText);
  const appIdField = stringToField(appIdText);
  const userAddrField = parseField(buyerAddressHex, "buyerAddress");
  const chainIdField = parseField(session.chainId, "chainId");
  const timestampField = parseField(session.timestamp, "timestamp");
  const intentIdField = parseField(intentIdHex, "intentId");
  const amountField = parseField(session.amount, "amount");
  const wiseReceiptHashField = parseField(wiseReceiptHashHex, "wiseReceiptHash");

  const statementField = computeStatement({
    businessDomainField,
    appIdField,
    userAddrField,
    chainIdField,
    timestampField,
    intentIdField,
    amountField
  });
  const nullifierField = computeNullifier(secretField, intentIdField);
  const wiseWitnessHashField = computeWiseWitnessHash({
    amountField,
    timestampField,
    userAddrField,
    wiseReceiptHashField,
    secretField
  });

  const derivedStatementHex = fieldToHex32(statementField);
  const derivedNullifierHex = fieldToHex32(nullifierField);

  if (intentHashHex !== intentIdHex) {
    throw new Error(
      `intentHash mismatch: intentHash=${intentHashHex} intentId=${intentIdHex}. ` +
        "Current circuit binds intentHash to intentId."
    );
  }

  if (session.statement) {
    const sessionStatement = normalizeHex32(session.statement, "statement");
    if (sessionStatement !== derivedStatementHex) {
      throw new Error(
        `statement mismatch: session=${sessionStatement} derived=${derivedStatementHex}`
      );
    }
  }
  if (session.nullifier) {
    const sessionNullifier = normalizeHex32(session.nullifier, "nullifier");
    if (sessionNullifier !== derivedNullifierHex) {
      throw new Error(
        `nullifier mismatch: session=${sessionNullifier} derived=${derivedNullifierHex}. ` +
          "This order was created with incompatible nullifier derivation. Start a new order."
      );
    }
  }

  const publicInputsByName = {
    business_domain: businessDomainField.toString(),
    app_id: appIdField.toString(),
    user_addr: userAddrField.toString(),
    chain_id: chainIdField.toString(),
    timestamp: timestampField.toString(),
    intent_id: intentIdField.toString(),
    // Alias for higher-level binding checks; current circuit uses intent_id as binding field.
    intent_hash: intentIdField.toString(),
    amount: amountField.toString(),
    wise_receipt_hash: wiseReceiptHashField.toString(),
    nullifier: nullifierField.toString(),
    statement: statementField.toString()
  };

  const privateInputsByName = {
    secret: secretField.toString(),
    wise_witness_hash: wiseWitnessHashField.toString()
  };

  return {
    circuitName: "zkp2p_horizen_release",
    publicInputsByName,
    privateInputsByName,
    allInputsByName: {
      ...publicInputsByName,
      ...privateInputsByName
    },
    publicInputsOrdered: [
      publicInputsByName.business_domain,
      publicInputsByName.app_id,
      publicInputsByName.user_addr,
      publicInputsByName.chain_id,
      publicInputsByName.timestamp,
      publicInputsByName.intent_id,
      publicInputsByName.amount,
      publicInputsByName.wise_receipt_hash,
      publicInputsByName.nullifier,
      publicInputsByName.statement
    ],
    expectedHex: {
      intentHash: intentHashHex,
      statement: derivedStatementHex,
      nullifier: derivedNullifierHex,
      wiseWitnessHash: fieldToHex32(wiseWitnessHashField)
    }
  };
}
