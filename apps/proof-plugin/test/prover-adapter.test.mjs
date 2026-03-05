import test from "node:test";
import assert from "node:assert/strict";
import { runBrowserProving } from "../lib/prover-adapter.js";

function hex32FromNumber(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function baseSession() {
  return {
    proofSystem: "ultrahonk",
    proofId: "proof-1",
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

test("runBrowserProving uses extension global prover without senderTabId", async () => {
  const previous = globalThis.__ZKP2P_NOIR_PROVER__;
  globalThis.__ZKP2P_NOIR_PROVER__ = {
    async prove(payload) {
      assert.equal(payload.circuitName, "zkp2p_horizen_release");
      assert.equal(payload.circuitInputs.amount, "100000000");
      return {
        proof: "0xproof",
        publicInputs: ["1", "2"]
      };
    }
  };

  try {
    const result = await runBrowserProving({
      session: baseSession(),
      capture: { tlsn: { ok: true } }
    });
    assert.deepEqual(result, {
      proof: "0xproof",
      publicInputs: ["1", "2"]
    });
  } finally {
    globalThis.__ZKP2P_NOIR_PROVER__ = previous;
  }
});

test("runBrowserProving executes in dApp tab runtime when senderTabId exists", async () => {
  const previousChrome = globalThis.chrome;
  const previous = globalThis.__ZKP2P_NOIR_PROVER__;
  globalThis.__ZKP2P_NOIR_PROVER__ = undefined;

  let executeCalls = 0;
  globalThis.chrome = {
    scripting: {
      async executeScript({ target, world, args }) {
        executeCalls += 1;
        assert.equal(target.tabId, 3011);
        assert.equal(world, "MAIN");
        assert.equal(args.length, 1);
        assert.equal(args[0].circuitName, "zkp2p_horizen_release");
        assert.equal("wise" in args[0], false);
        assert.equal("wiseAttestation" in args[0], false);
        return [{ result: { ok: true, proving: { proof: "0xtabproof", publicInputs: ["9", "8"] } } }];
      }
    }
  };

  try {
    const result = await runBrowserProving({
      session: {
        ...baseSession(),
        senderTabId: 3011
      },
      capture: { tlsn: { ok: true } }
    });

    assert.equal(executeCalls, 1);
    assert.deepEqual(result, {
      proof: "0xtabproof",
      publicInputs: ["9", "8"]
    });
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.__ZKP2P_NOIR_PROVER__ = previous;
  }
});

test("runBrowserProving surfaces dApp prover errors from executeScript", async () => {
  const previousChrome = globalThis.chrome;
  const previous = globalThis.__ZKP2P_NOIR_PROVER__;
  globalThis.__ZKP2P_NOIR_PROVER__ = undefined;

  globalThis.chrome = {
    scripting: {
      async executeScript() {
        return [{ result: { ok: false, error: "No dApp page prover configured." } }];
      }
    }
  };

  try {
    await assert.rejects(
      () =>
        runBrowserProving({
          session: {
            ...baseSession(),
            senderTabId: 3011
          },
          capture: { tlsn: { ok: true } }
        }),
      /No dApp page prover configured/
    );
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.__ZKP2P_NOIR_PROVER__ = previous;
  }
});
