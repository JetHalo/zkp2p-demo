const MESSAGES = {
  START_PROOF: "ZKP2P_PLUGIN_START_PROOF",
  CAPTURE_FROM_ACTIVE_TAB: "ZKP2P_PLUGIN_CAPTURE_FROM_ACTIVE_TAB",
  VERIFY_SELECTED_PAYMENT: "ZKP2P_PLUGIN_VERIFY_SELECTED_PAYMENT",
  PREVIEW_PROVING_INPUTS: "ZKP2P_PLUGIN_PREVIEW_PROVING_INPUTS",
  RUN_PROVING: "ZKP2P_PLUGIN_RUN_PROVING",
  SUBMIT_PROOF: "ZKP2P_PLUGIN_SUBMIT_PROOF",
  QUERY_STATUS: "ZKP2P_PLUGIN_QUERY_STATUS",
  QUERY_AGGREGATION: "ZKP2P_PLUGIN_QUERY_AGGREGATION",
  GET_SESSION: "ZKP2P_PLUGIN_GET_SESSION",
  RESET_SESSION: "ZKP2P_PLUGIN_RESET_SESSION",
  STATUS_EVENT: "ZKP2P_PLUGIN_STATUS_EVENT"
};

(function injectBridge() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("inpage-bridge.js");
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
})();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "zkp2p-dapp" || typeof data.type !== "string") return;

  const supported = new Set([
    MESSAGES.START_PROOF,
    MESSAGES.CAPTURE_FROM_ACTIVE_TAB,
    MESSAGES.VERIFY_SELECTED_PAYMENT,
    MESSAGES.PREVIEW_PROVING_INPUTS,
    MESSAGES.RUN_PROVING,
    MESSAGES.SUBMIT_PROOF,
    MESSAGES.QUERY_STATUS,
    MESSAGES.QUERY_AGGREGATION,
    MESSAGES.GET_SESSION,
    MESSAGES.RESET_SESSION
  ]);

  if (!supported.has(data.type)) return;

  chrome.runtime.sendMessage({ type: data.type, payload: data.payload }, (response) => {
    window.postMessage(
      {
        source: "zkp2p-plugin",
        type: `${data.type}:response`,
        requestId: data.requestId,
        payload: response
      },
      "*"
    );
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== MESSAGES.STATUS_EVENT) return;

  window.postMessage(
    {
      source: "zkp2p-plugin",
      type: MESSAGES.STATUS_EVENT,
      payload: message.payload
    },
    "*"
  );
});
