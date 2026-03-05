import { PROOF_SYSTEM } from "./constants.js";
import { deriveCircuitInputs } from "./circuit-inputs.js";

// Browser-only proving adapter.
// The project embedding this plugin must provide a real prover runtime.
async function runInDappTab(tabId, witness) {
  if (!chrome?.scripting?.executeScript) {
    throw new Error("chrome.scripting.executeScript is not available");
  }

  const execResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [witness],
    func: async (payload) => {
      try {
        let prover = globalThis.__ZKP2P_NOIR_PROVER__;
        if ((!prover || typeof prover.prove !== "function") && typeof globalThis.__ZKP2P_ENSURE_PROVER__ === "function") {
          await globalThis.__ZKP2P_ENSURE_PROVER__();
          prover = globalThis.__ZKP2P_NOIR_PROVER__;
        }
        if (!prover || typeof prover.prove !== "function") {
          return {
            ok: false,
            error:
              "No dApp page prover configured. Keep the zkp2p page open, refresh once, then retry."
          };
        }
        const proving = await prover.prove(payload);
        return { ok: true, proving };
      } catch (error) {
        return {
          ok: false,
          error: String(error?.message || error)
        };
      }
    }
  });

  const envelope = Array.isArray(execResults) ? execResults[0]?.result : null;
  if (!envelope || typeof envelope !== "object") {
    throw new Error("dApp page prover returned empty result");
  }

  if (envelope.ok !== true) {
    throw new Error(String(envelope.error || "dApp page prover failed"));
  }
  return envelope.proving;
}

export async function runBrowserProving({ session, capture }) {
  if (session?.proofSystem !== PROOF_SYSTEM) {
    throw new Error(`Unsupported proof system: expected ${PROOF_SYSTEM}`);
  }

  const circuit = deriveCircuitInputs(session);

  const witness = {
    circuitName: circuit.circuitName,
    circuitInputs: circuit.allInputsByName,
    circuitPublicInputs: circuit.publicInputsByName,
    circuitPrivateInputs: circuit.privateInputsByName,
    expectedPublicInputsOrder: circuit.publicInputsOrdered,
    expectedHex: circuit.expectedHex
  };

  let result = null;
  const senderTabId = Number(session?.senderTabId);
  if (Number.isInteger(senderTabId) && senderTabId > 0) {
    result = await runInDappTab(senderTabId, witness);
  } else if (typeof globalThis.__ZKP2P_NOIR_PROVER__?.prove === "function") {
    // Fallback for environments that provide prover in extension context.
    result = await globalThis.__ZKP2P_NOIR_PROVER__.prove(witness);
  } else {
    throw new Error(
      "No browser prover configured. Register __ZKP2P_NOIR_PROVER__.prove in dApp page runtime."
    );
  }

  if (!result || typeof result.proof !== "string" || !Array.isArray(result.publicInputs)) {
    throw new Error("Invalid prover output. Expected { proof: string, publicInputs: string[] }");
  }

  return {
    proof: result.proof,
    publicInputs: result.publicInputs
  };
}
