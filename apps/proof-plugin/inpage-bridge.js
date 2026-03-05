(function installZkp2pPluginBridge() {
  if (window.zkp2pProofPlugin) {
    return;
  }

  const pending = new Map();

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "zkp2p-plugin" || typeof data.type !== "string") return;

    if (data.type.endsWith(":response")) {
      const requestId = data.requestId;
      const resolver = requestId ? pending.get(requestId) : null;
      if (resolver) {
        resolver(data.payload);
        pending.delete(requestId);
      }
      return;
    }

    if (data.type === "ZKP2P_PLUGIN_STATUS_EVENT") {
      window.dispatchEvent(
        new CustomEvent("zkp2p-plugin-status", {
          detail: data.payload
        })
      );
    }
  });

  const request = (type, payload) =>
    new Promise((resolve) => {
      const requestId = `${type}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      pending.set(requestId, resolve);
      window.postMessage({ source: "zkp2p-dapp", type, payload, requestId }, "*");
    });

  window.zkp2pProofPlugin = {
    startProof: (payload) => request("ZKP2P_PLUGIN_START_PROOF", payload),
    captureFromActiveTab: (proofId) => request("ZKP2P_PLUGIN_CAPTURE_FROM_ACTIVE_TAB", { proofId }),
    verifySelectedPayment: (proofId, payment) =>
      request("ZKP2P_PLUGIN_VERIFY_SELECTED_PAYMENT", { proofId, payment }),
    previewProvingInputs: (proofId) => request("ZKP2P_PLUGIN_PREVIEW_PROVING_INPUTS", { proofId }),
    runProving: (proofId) => request("ZKP2P_PLUGIN_RUN_PROVING", { proofId }),
    submitProof: (proofId) => request("ZKP2P_PLUGIN_SUBMIT_PROOF", { proofId }),
    queryStatus: (proofId) => request("ZKP2P_PLUGIN_QUERY_STATUS", { proofId }),
    queryAggregation: (proofId) => request("ZKP2P_PLUGIN_QUERY_AGGREGATION", { proofId }),
    getSession: (proofId) => request("ZKP2P_PLUGIN_GET_SESSION", { proofId }),
    resetSession: (proofId) => request("ZKP2P_PLUGIN_RESET_SESSION", { proofId })
  };
})();
