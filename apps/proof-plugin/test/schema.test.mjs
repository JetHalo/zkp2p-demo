import test from "node:test";
import assert from "node:assert/strict";

import { validateStartPayload } from "../lib/schema.js";

function basePayload() {
  return {
    proofId: "proof-1",
    intentId: "0x1111111111111111111111111111111111111111111111111111111111111111",
    intentHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    proverSecret: "505",
    buyerAddress: "0x000000000000000000000000000000000000b0b0",
    amount: "100000000",
    businessDomain: "zkp2p-horizen",
    aggregationDomainId: "horizen-eon",
    appId: "zkp2p",
    nullifier: "0x2222222222222222222222222222222222222222222222222222222222222222",
    submitEndpoint: "http://localhost:3011/api/submit-proof",
    statusEndpoint: "http://localhost:3011/api/proof-status",
    aggregationEndpoint: "http://localhost:3011/api/proof-aggregation",
    wiseAttestationEndpoint: "http://localhost:3011/api/verify-wise-attestation",
    tlsnPluginUrl: "https://example.com/plugins/wise.tlsn-plugin.wasm",
    verificationMode: "aggregation-kurier",
    chainId: 2651420,
    timestamp: 1739102400,
    publicInputs: []
  };
}

test("validateStartPayload rejects payload without proofSystem", () => {
  const payload = basePayload();
  const result = validateStartPayload(payload);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.includes("proofSystem")));
});

test("validateStartPayload accepts ultrahonk proof system", () => {
  const payload = {
    ...basePayload(),
    proofSystem: "ultrahonk"
  };

  const result = validateStartPayload(payload);
  assert.equal(result.ok, true);
});
