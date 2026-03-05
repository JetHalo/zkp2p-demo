import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import initACVM from "@noir-lang/acvm_js";
import initNoirC from "@noir-lang/noirc_abi";
import acvmWasmUrl from "@noir-lang/acvm_js/web/acvm_js_bg.wasm?url";
import noircAbiWasmUrl from "@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url";

type ProofResult = {
  proof: string;
  publicInputs: string[];
};

type WitnessPayload = {
  circuitName: string;
  circuitInputs: Record<string, string>;
  circuitPublicInputs: Record<string, string>;
  circuitPrivateInputs: Record<string, string>;
  expectedPublicInputsOrder: string[];
  expectedHex: {
    statement: string;
    nullifier: string;
    wiseWitnessHash: string;
  };
};

type BrowserProver = {
  prove: (payload: WitnessPayload) => Promise<ProofResult>;
};

declare global {
  interface Window {
    __ZKP2P_NOIR_PROVER__?: BrowserProver;
    __ZKP2P_ENSURE_PROVER__?: () => Promise<void>;
  }
}

let installPromise: Promise<void> | null = null;
let runtimeInitPromise: Promise<void> | null = null;

function toHex(value: unknown): string {
  if (typeof value === "string") {
    if (value.startsWith("0x")) return value;
    return `0x${value}`;
  }
  if (value instanceof Uint8Array) {
    const hex = Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
    return `0x${hex}`;
  }
  throw new Error("Unsupported proof payload type from backend.generateProof");
}

function normalizePublicInputToHex(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    if (/^0x[0-9a-fA-F]+$/.test(text)) {
      return `0x${text.slice(2).toLowerCase()}`;
    }
    if (/^[0-9]+$/.test(text)) {
      return `0x${BigInt(text).toString(16)}`;
    }
    throw new Error(`Unsupported public input string: ${text.slice(0, 64)}`);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `0x${BigInt(Math.trunc(value)).toString(16)}`;
  }
  if (typeof value === "bigint") {
    return `0x${value.toString(16)}`;
  }
  if (value instanceof Uint8Array) {
    return toHex(value).toLowerCase();
  }
  throw new Error(`Unsupported public input type: ${Object.prototype.toString.call(value)}`);
}

async function initNoirWasmRuntime() {
  if (runtimeInitPromise) {
    await runtimeInitPromise;
    return;
  }

  runtimeInitPromise = (async () => {
    await Promise.all([initACVM(fetch(acvmWasmUrl)), initNoirC(fetch(noircAbiWasmUrl))]);
  })().catch((error) => {
    runtimeInitPromise = null;
    throw new Error(`Noir wasm runtime initialization failed: ${String((error as Error)?.message ?? error)}`);
  });

  await runtimeInitPromise;
}

async function fetchCircuitArtifact() {
  const response = await fetch("/api/circuit-artifact?name=zkp2p_horizen_release", {
    method: "GET",
    cache: "no-store"
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Circuit artifact fetch failed: ${response.status} ${body}`);
  }
  return (await response.json()) as Record<string, unknown> & {
    bytecode: string;
  };
}

async function installBrowserProver() {
  await initNoirWasmRuntime();
  const circuit = await fetchCircuitArtifact();

  const noir = new Noir(circuit as never);
  const backend = new UltraHonkBackend(circuit.bytecode);
  const ultraHonkOptions = { keccak: true as const };

  window.__ZKP2P_NOIR_PROVER__ = {
    async prove(payload: WitnessPayload): Promise<ProofResult> {
      const { witness } = await noir.execute(payload.circuitInputs);
      // Must match VK generation (`bb ... --oracle_hash keccak`).
      const generated = await backend.generateProof(witness, ultraHonkOptions);
      const locallyVerified = await backend.verifyProof(generated, ultraHonkOptions);
      if (!locallyVerified) {
        throw new Error("Local UltraHonk verification failed (oracle hash / VK mismatch)");
      }

      return {
        proof: toHex(generated.proof),
        publicInputs: Array.isArray(generated.publicInputs)
          ? generated.publicInputs.map(normalizePublicInputToHex)
          : []
      };
    }
  };
}

export async function ensureBrowserProverInstalled(): Promise<void> {
  if (typeof window === "undefined") return;
  // Expose lazy bootstrap so extension can trigger init on demand.
  window.__ZKP2P_ENSURE_PROVER__ = ensureBrowserProverInstalled;
  if (window.__ZKP2P_NOIR_PROVER__?.prove) return;

  if (!installPromise) {
    installPromise = installBrowserProver().catch((error) => {
      installPromise = null;
      throw error;
    });
  }
  await installPromise;
}
