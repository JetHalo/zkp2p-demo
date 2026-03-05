export interface StatementInput {
  intentId: `0x${string}`;
  buyerAddress: `0x${string}`;
  amount: bigint;
  chainId: bigint;
  timestamp: bigint;
  businessDomain: string;
  appId: string;
}

export const FIELD_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const MIMC_ROUNDS = 91;

function mod(v: bigint): bigint {
  const r = v % FIELD_MODULUS;
  return r >= 0n ? r : r + FIELD_MODULUS;
}

function pow7(x: bigint): bigint {
  const x2 = mod(x * x);
  const x4 = mod(x2 * x2);
  return mod(x4 * x2 * x);
}

function mimc7Permute(input: bigint, key: bigint): bigint {
  let state = mod(input);
  const k = mod(key);
  for (let i = 0; i < MIMC_ROUNDS; i += 1) {
    const c = BigInt(i + 1);
    state = pow7(mod(state + k + c));
  }
  return mod(state + k);
}

function mimc7Hash2(left: bigint, right: bigint): bigint {
  const r = mod(right);
  return mod(mimc7Permute(left, r) + r);
}

function hexToField(hex: string): bigint {
  if (!hex) return 0n;
  const normalized = hex.startsWith("0x") ? hex : `0x${hex}`;
  return mod(BigInt(normalized));
}

function stringToField(text: string): bigint {
  const bytes = new TextEncoder().encode(text);
  let out = 0n;
  for (const byte of bytes) {
    out = mod(out * 256n + BigInt(byte));
  }
  return out;
}

export function fieldToHex32(value: bigint): `0x${string}` {
  const hex = mod(value).toString(16).padStart(64, "0");
  return `0x${hex}` as `0x${string}`;
}

export function buildStatementField(input: StatementInput): bigint {
  const businessDomain = stringToField(input.businessDomain);
  const appId = stringToField(input.appId);
  const userAddr = hexToField(input.buyerAddress);
  const intentId = hexToField(input.intentId);
  const amount = mod(input.amount);
  const chainId = mod(input.chainId);
  const timestamp = mod(input.timestamp);

  let acc = mimc7Hash2(intentId, userAddr);
  acc = mimc7Hash2(acc, amount);
  acc = mimc7Hash2(acc, chainId);
  acc = mimc7Hash2(acc, timestamp);
  acc = mimc7Hash2(acc, businessDomain);
  return mimc7Hash2(acc, appId);
}

export function buildStatement(input: StatementInput): `0x${string}` {
  return fieldToHex32(buildStatementField(input));
}

export function buildNullifierField(input: {
  secret: bigint;
  intentId: `0x${string}`;
}): bigint {
  return mimc7Hash2(mod(input.secret), hexToField(input.intentId));
}

export function buildNullifier(input: {
  secret: bigint;
  intentId: `0x${string}`;
}): `0x${string}` {
  return fieldToHex32(buildNullifierField(input));
}

export function statementEqualsLeaf(statement: string, leaf: string): boolean {
  return statement.toLowerCase() === leaf.toLowerCase();
}
