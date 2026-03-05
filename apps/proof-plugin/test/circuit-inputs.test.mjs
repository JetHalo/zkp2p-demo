import test from "node:test";
import assert from "node:assert/strict";
import { deriveCircuitInputs } from "../lib/circuit-inputs.js";

function hex32FromNumber(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function baseSession() {
  return {
    businessDomain: "zkp2p-horizen",
    appId: "zkp2p",
    buyerAddress: "0x000000000000000000000000000000000000b0b0",
    chainId: 7332,
    timestamp: 1739102400,
    intentId: hex32FromNumber(404),
    amount: "100000000",
    wiseReceiptHash: hex32FromNumber(707),
    proverSecret: "505"
  };
}

test("deriveCircuitInputs computes deterministic public/private inputs", () => {
  const first = deriveCircuitInputs(baseSession());
  const second = deriveCircuitInputs({
    ...baseSession(),
    statement: first.expectedHex.statement,
    nullifier: first.expectedHex.nullifier
  });

  assert.equal(second.circuitName, "zkp2p_horizen_release");
  assert.equal(second.publicInputsByName.amount, "100000000");
  assert.equal(second.publicInputsByName.chain_id, "7332");
  assert.equal(second.expectedHex.statement, first.expectedHex.statement);
  assert.equal(second.expectedHex.nullifier, first.expectedHex.nullifier);
  assert.equal(second.publicInputsOrdered.length, 10);
  assert.match(second.expectedHex.wiseWitnessHash, /^0x[0-9a-f]{64}$/);
});

test("deriveCircuitInputs rejects nullifier mismatch", () => {
  const first = deriveCircuitInputs(baseSession());
  assert.throws(
    () =>
      deriveCircuitInputs({
        ...baseSession(),
        statement: first.expectedHex.statement,
        nullifier: hex32FromNumber(1)
      }),
    /nullifier mismatch/
  );
});

test("deriveCircuitInputs requires proverSecret", () => {
  assert.throws(
    () =>
      deriveCircuitInputs({
        ...baseSession(),
        proverSecret: ""
      }),
    /proverSecret/
  );
});
