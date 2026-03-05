import { MESSAGES, SESSION_STATUS } from "./lib/constants.js";

const STEPS = ["payment", "authenticate", "verify"];

const screenTitle = document.getElementById("screenTitle");
const backBtn = document.getElementById("backBtn");
const proofValue = document.getElementById("proofValue");
const statusLine = document.getElementById("statusLine");
const expiryText = document.getElementById("expiryText");
const preProofDump = document.getElementById("preProofDump");

const paymentPanel = document.getElementById("paymentPanel");
const authPanel = document.getElementById("authPanel");
const verifyPanel = document.getElementById("verifyPanel");

const ackInput = document.getElementById("ackInput");
const paymentCta = document.getElementById("paymentCta");
const refreshPaymentsBtn = document.getElementById("refreshPayments");
const paymentList = document.getElementById("paymentList");
const selectPaymentCta = document.getElementById("selectPaymentCta");

const selectedPaymentLabel = document.getElementById("selectedPaymentLabel");
const selectedPaymentSub = document.getElementById("selectedPaymentSub");
const verifyLine = document.getElementById("verifyLine");
const verifyHint = document.getElementById("verifyHint");
const flowPaymentStatus = document.getElementById("flowPaymentStatus");
const flowVerifyStatus = document.getElementById("flowVerifyStatus");
const flowDoneStatus = document.getElementById("flowDoneStatus");
const receiveHint = document.getElementById("receiveHint");
const verifyCta = document.getElementById("verifyCta");
const finalLink = document.getElementById("finalLink");

const state = {
  step: "payment",
  proofId: "",
  session: null,
  payments: [],
  selectedIndex: null,
  selectionVerified: false,
  verifyBusy: false,
  verifyDone: false
};

let expiryTimer = null;
const STATUS_POLL_INTERVAL_MS = 5000;
const STATUS_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function isSessionFinal(status) {
  return status === SESSION_STATUS.AGGREGATED || status === SESSION_STATUS.ERROR;
}

function setStatus(text, type = "") {
  statusLine.textContent = compactText(normalizeStatusText(text));
  statusLine.className = `status-line${type ? ` ${type}` : ""}`;
}

function showPreProofDump(payload) {
  if (!preProofDump) return;
  if (!payload || typeof payload !== "object") {
    preProofDump.textContent = "";
    preProofDump.classList.remove("show");
    return;
  }
  try {
    const text = JSON.stringify(payload, null, 2);
    preProofDump.textContent = text.length > 12000 ? `${text.slice(0, 12000)}\n...truncated...` : text;
  } catch {
    preProofDump.textContent = String(payload);
  }
  preProofDump.classList.add("show");
}

function normalizeStatusText(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === "object") {
    const details = Array.isArray(value.details)
      ? value.details.filter((item) => typeof item === "string" && item.trim())
      : [];
    const attempts = Array.isArray(value.attempts) ? value.attempts : [];
    const attemptHints = attempts
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const status = typeof item.status === "number" ? item.status : null;
        const message = typeof item.message === "string" ? item.message.trim() : "";
        if (status != null && message) return `${status}: ${message}`;
        if (status != null) return String(status);
        return message;
      })
      .filter(Boolean);

    const directMessage =
      typeof value.message === "string" && value.message.trim()
        ? value.message.trim()
        : typeof value.error === "string" && value.error.trim()
          ? value.error.trim()
          : "";
    if (directMessage && (details.length > 0 || attemptHints.length > 0)) {
      const hints = [...details, ...attemptHints];
      return `${directMessage} (${hints.join(" | ")})`;
    }
    if (directMessage) return directMessage;
    if (details.length > 0) return details.join(" | ");
    if (attemptHints.length > 0) return attemptHints.join(" | ");
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function normalizeErrorMessage(error, fallback = "plugin action failed") {
  if (error instanceof Error) {
    return normalizeStatusText(error.message || fallback) || fallback;
  }
  const normalized = normalizeStatusText(error);
  return normalized || fallback;
}

function resolveSessionDeadlineSec(session) {
  const deadline = Number(session?.deadline);
  if (Number.isFinite(deadline) && deadline > 0) return Math.floor(deadline);

  const ts = Number(session?.timestamp);
  if (Number.isFinite(ts) && ts > 0) return Math.floor(ts + 30 * 60);

  return null;
}

function formatRemaining(secondsLeft) {
  if (secondsLeft <= 0) return "Order expired";
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;
  if (hours > 0) return `Order expires in ${hours}h ${minutes}m left`;
  if (minutes > 0) return `Order expires in ${minutes}m ${seconds}s left`;
  return `Order expires in ${seconds}s left`;
}

function updateExpiryCountdown() {
  if (!expiryText) return;
  const deadlineSec = resolveSessionDeadlineSec(state.session);
  if (!deadlineSec) {
    expiryText.textContent = "Order expiry unavailable";
    return;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = deadlineSec - nowSec;
  expiryText.textContent = formatRemaining(remaining);
}

function startExpiryTicker() {
  if (!expiryText) return;
  if (expiryTimer) clearInterval(expiryTimer);
  updateExpiryCountdown();
  expiryTimer = setInterval(updateExpiryCountdown, 1000);
}

function setStep(step) {
  state.step = step;
  const currentIndex = STEPS.indexOf(step);

  screenTitle.textContent = step === "verify" ? "VERIFY PAYMENT" : "COMPLETE PAYMENT";

  document.querySelectorAll(".step").forEach((node) => {
    const itemStep = node.dataset.step;
    const idx = STEPS.indexOf(itemStep);
    node.classList.remove("active", "done");
    if (idx < currentIndex) node.classList.add("done");
    if (idx === currentIndex) node.classList.add("active");
  });

  paymentPanel.classList.toggle("active", step === "payment");
  authPanel.classList.toggle("active", step === "authenticate");
  verifyPanel.classList.toggle("active", step === "verify");
}

function getProviderLabel(pageUrl) {
  if (!pageUrl) return "provider";
  try {
    const url = new URL(pageUrl);
    const [first] = url.hostname.split(".");
    return first || "provider";
  } catch {
    return "provider";
  }
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeRecipientForDisplay(raw) {
  const text = compactText(raw);
  if (!text) return "unknown";
  const withoutCompleted = text.replace(/completed.*$/i, "").trim();
  const normalized = withoutCompleted || text;
  return normalized.slice(0, 72);
}

function normalizePayment(item, fallbackCapture) {
  const transferIdRaw =
    item?.transferId ||
    item?.transactionId ||
    item?.transactionNumber ||
    item?.transactionNo ||
    item?.id ||
    "";
  const transferId = compactText(transferIdRaw);
  const amountRaw = compactText(item?.amount || fallbackCapture?.amountText || "unknown");
  const currencyRaw = compactText(item?.currency || "");
  const amount = currencyRaw && !amountRaw.toUpperCase().includes(currencyRaw.toUpperCase())
    ? `${amountRaw} ${currencyRaw}`
    : amountRaw;
  const recipientRaw = compactText(item?.payerRef || fallbackCapture?.recipientText || "unknown");
  const recipientDisplay = sanitizeRecipientForDisplay(recipientRaw);
  const when =
    item?.timestamp != null
      ? new Date(Number(item.timestamp) * 1000).toLocaleString()
      : fallbackCapture?.transferTimeText || "Recent";
  const provider = getProviderLabel(fallbackCapture?.pageUrl);
  const status = item?.status ? ` · ${compactText(item.status)}` : "";
  const transferHint = transferId ? ` · tx#${transferId}` : " · tx id unavailable";

  return {
    id: transferId || `${amountRaw}-${recipientDisplay}-${when}`,
    amount: String(amountRaw),
    payerRef: String(recipientRaw),
    transferId: String(transferId),
    timestamp: item?.timestamp != null ? Number(item.timestamp) : undefined,
    title: `Sent ${amount} to ${recipientDisplay}`,
    subtitle: `${when}${status}${transferHint} on ${provider}`
  };
}

function renderPaymentList() {
  paymentList.innerHTML = "";

  if (state.payments.length === 0) {
    const empty = document.createElement("button");
    empty.className = "payment-item empty";
    empty.type = "button";
    empty.disabled = true;
    empty.innerHTML = "<strong>No captured payment yet</strong><small>Open Wise tab, make payment, then click refresh.</small>";
    paymentList.appendChild(empty);
    selectPaymentCta.disabled = true;
    return;
  }

  state.payments.forEach((payment, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `payment-item${state.selectedIndex === index ? " selected" : ""}`;
    row.innerHTML = `<strong>${payment.title}</strong><small>${payment.subtitle}</small>`;
    row.addEventListener("click", () => {
      state.selectedIndex = index;
      state.selectionVerified = false;
      renderPaymentList();
      selectPaymentCta.disabled = false;
      setStatus("Payment selected. Click SELECT PAYMENT to run attestation verification.", "");
    });
    paymentList.appendChild(row);
  });

  selectPaymentCta.disabled = state.selectedIndex == null;
}

async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) {
    throw new Error(normalizeErrorMessage(response?.error, "plugin action failed"));
  }
  return response;
}

async function loadSession(force = false) {
  if (state.session && !force) return true;

  const rootResp = await sendMessage(MESSAGES.GET_SESSION, {});
  const activeProofId = rootResp?.root?.activeProofId;
  if (!activeProofId) {
    setStatus("No active proof order. Start an order from dApp first.", "error");
    proofValue.textContent = "-";
    return false;
  }

  state.proofId = activeProofId;
  proofValue.textContent = activeProofId;

  const sessionResp = await sendMessage(MESSAGES.GET_SESSION, { proofId: activeProofId });
  state.session = sessionResp.session || null;

  hydrateFromSession();
  return true;
}

function hydrateFromSession() {
  if (!state.session) return;

  const status = String(state.session.status || "pending");
  startExpiryTicker();

  if (state.session.capture) {
    const recent = Array.isArray(state.session.recentTransfers) ? state.session.recentTransfers : [];
    if (recent.length > 0) {
      state.payments = recent.map((item) => normalizePayment(item, state.session.capture));
      state.selectedIndex = 0;
    } else {
      state.payments = [];
      state.selectedIndex = null;
    }
    renderPaymentList();
  }

  if (status === SESSION_STATUS.CAPTURE_READY) {
    setStep("authenticate");
  }

  if (status === SESSION_STATUS.WISE_OPENED) {
    setStep("authenticate");
    setStatus("Wise opened. Complete payment, then capture in Authenticate step.", "ok");
  }

  if (
    status === SESSION_STATUS.PROVING ||
    status === SESSION_STATUS.PROOF_READY ||
    status === SESSION_STATUS.SUBMITTED ||
    status === SESSION_STATUS.VERIFIED ||
    status === SESSION_STATUS.AGGREGATED ||
    status === SESSION_STATUS.ERROR
  ) {
    setStep("verify");
  }

  updateVerifyPanel(status, state.session.statusResponse || {});
  setStatus(`Session ready: ${status}`, "ok");
}

function updateVerifyPanel(pluginStatus, detail = {}) {
  const selected = state.selectedIndex == null ? state.payments[0] : state.payments[state.selectedIndex];

  if (selected) {
    selectedPaymentLabel.textContent = selected.title;
    selectedPaymentSub.textContent = selected.subtitle;
    flowPaymentStatus.className = "status done";
    flowPaymentStatus.textContent = "✓";
  }

  if (pluginStatus === SESSION_STATUS.PROVING) {
    verifyLine.textContent = "Verifying Payment";
    verifyHint.textContent = "Can take up to 30 seconds";
    flowVerifyStatus.className = "status loading";
    flowVerifyStatus.textContent = "...";
    flowDoneStatus.className = "status";
    flowDoneStatus.textContent = "○";
    verifyCta.textContent = "VERIFYING PAYMENT";
    verifyCta.disabled = true;
    return;
  }

  if (
    pluginStatus === SESSION_STATUS.PROOF_READY ||
    pluginStatus === SESSION_STATUS.SUBMITTED ||
    pluginStatus === SESSION_STATUS.VERIFIED
  ) {
    flowVerifyStatus.className = "status done";
    flowVerifyStatus.textContent = "✓";
    flowDoneStatus.className = "status";
    flowDoneStatus.textContent = "○";
    verifyCta.textContent = "CHECK STATUS";
    verifyCta.disabled = false;
    return;
  }

  if (pluginStatus === SESSION_STATUS.AGGREGATED) {
    state.verifyDone = true;
    state.verifyBusy = false;
    flowVerifyStatus.className = "status done";
    flowVerifyStatus.textContent = "✓";
    flowDoneStatus.className = "status done";
    flowDoneStatus.textContent = "✓";
    verifyLine.textContent = "Payment Verified";
    verifyHint.textContent = "Aggregation tuple ready";
    receiveHint.textContent = "Release can now proceed on Horizen";
    verifyCta.textContent = "GO TO BUY";
    verifyCta.disabled = false;

    const txHash = detail?.txHash || detail?.aggregationTxHash;
    if (txHash) {
      finalLink.textContent = `Aggregation tx: ${txHash}`;
      finalLink.href = "#";
      finalLink.classList.add("show");
    }
    return;
  }

  if (pluginStatus === SESSION_STATUS.ERROR) {
    state.verifyBusy = false;
    verifyCta.textContent = "RETRY VERIFY";
    verifyCta.disabled = false;
    flowVerifyStatus.className = "status";
    flowVerifyStatus.textContent = "!";
    setStatus("Verification failed. Retry after fixing provider/session state.", "error");
    return;
  }

  verifyCta.textContent = "VERIFY PAYMENT";
  verifyCta.disabled = !state.selectionVerified;
  verifyHint.textContent = state.selectionVerified
    ? "Attestation verified. Click to start proof"
    : "Select one payment and verify attestation first";
}

async function refreshPaymentCandidates() {
  const hasSession = await loadSession();
  if (!hasSession) return;

  setStatus("Capturing payment details from active tab...", "");
  const captured = await sendMessage(MESSAGES.CAPTURE_FROM_ACTIVE_TAB, { proofId: state.proofId });

  state.session = {
    ...state.session,
    capture: captured.capture,
    recentTransfers: captured.recentTransfers || [],
    status: captured.status,
    wiseReceiptHash: null
  };
  state.selectionVerified = false;
  state.payments = (captured.recentTransfers || []).map((item) =>
    normalizePayment(item, captured.capture)
  );
  if (state.payments.length === 0) {
    state.selectedIndex = null;
    renderPaymentList();
    setStatus("No real Wise transfers captured. Open Wise transfer history and click refresh again.", "error");
    return;
  }
  state.selectedIndex = 0;

  renderPaymentList();
  setStatus("Recent payments captured. Select one payment, then click SELECT PAYMENT.", "ok");
}

async function runVerificationFlow() {
  if (state.verifyBusy) return;

  const hasSession = await loadSession();
  if (!hasSession) return;
  if (!state.selectionVerified) {
    setStatus("Select and verify one payment first.", "error");
    return;
  }
  if (state.selectedIndex == null && state.payments.length === 0) {
    setStatus("Capture and select a payment first.", "error");
    return;
  }

  try {
    state.verifyBusy = true;
    state.verifyDone = false;
    verifyCta.disabled = true;
    const sessionStatus = String(state.session?.status || "").toLowerCase();
    const alreadySubmitted =
      sessionStatus === SESSION_STATUS.SUBMITTED ||
      sessionStatus === SESSION_STATUS.VERIFIED ||
      sessionStatus === SESSION_STATUS.AGGREGATED;

    if (!alreadySubmitted) {
      const previewResp = await sendMessage(MESSAGES.PREVIEW_PROVING_INPUTS, { proofId: state.proofId });
      if (previewResp?.preview) {
        showPreProofDump(previewResp.preview);
        console.log("[ZKP2P][pre-proof-inputs]", previewResp.preview);
        setStatus("Pre-proof inputs captured. Review JSON below, then proving starts.", "");
      }

      updateVerifyPanel(SESSION_STATUS.PROVING);
      setStatus("Running browser proving...", "");
      await sendMessage(MESSAGES.RUN_PROVING, { proofId: state.proofId });

      setStatus("Submitting proof to relay...", "");
      await sendMessage(MESSAGES.SUBMIT_PROOF, { proofId: state.proofId });
    } else {
      setStatus("Proof already submitted. Checking status...", "");
    }

    const maxTries = Math.ceil(STATUS_POLL_TIMEOUT_MS / STATUS_POLL_INTERVAL_MS);
    let tries = 0;
    const startedAt = Date.now();
    while (Date.now() - startedAt < STATUS_POLL_TIMEOUT_MS) {
      tries += 1;
      const statusResp = await sendMessage(MESSAGES.QUERY_STATUS, { proofId: state.proofId });
      const pluginStatus = statusResp.status || SESSION_STATUS.SUBMITTED;
      const rawStatus = String(
        statusResp?.statusResponse?.rawStatus ??
          statusResp?.statusResponse?.status ??
          statusResp?.statusResponse?.proofStatus ??
          statusResp?.statusResponse?.verificationStatus ??
          statusResp?.statusResponse?.state ??
          ""
      ).toLowerCase();
      state.session = {
        ...state.session,
        status: pluginStatus,
        statusResponse: statusResp.statusResponse || state.session?.statusResponse
      };
      updateVerifyPanel(pluginStatus, statusResp.statusResponse || {});

      if (pluginStatus === SESSION_STATUS.AGGREGATED) {
        setStatus("Verification completed. Ready for release.", "ok");
        return;
      }

      if (pluginStatus === SESSION_STATUS.ERROR) {
        throw new Error(
          normalizeErrorMessage(statusResp.statusResponse || statusResp.error || "status returned error")
        );
      }

      if (pluginStatus === SESSION_STATUS.VERIFIED) {
        if (rawStatus.includes("aggregation pending") || rawStatus.includes("aggregationpending")) {
          setStatus(`On-chain verified. Waiting aggregation receipt... (${tries}/${maxTries})`, "");
        } else {
          setStatus(`Proof verified on zkVerify. Waiting aggregation... (${tries}/${maxTries})`, "");
        }
        await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
        continue;
      }

      setStatus(`Verification pending... (${tries}/${maxTries})`, "");
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
    }

    setStatus("Still pending after auto polling for up to 10 minutes. You can click CHECK STATUS again.", "");
    updateVerifyPanel(SESSION_STATUS.SUBMITTED);
  } catch (error) {
    updateVerifyPanel(SESSION_STATUS.ERROR);
    setStatus(normalizeErrorMessage(error, "Verification failed"), "error");
  } finally {
    state.verifyBusy = false;
    verifyCta.disabled = false;
  }
}

backBtn.addEventListener("click", () => {
  if (state.step === "verify") {
    setStep("authenticate");
    return;
  }
  if (state.step === "authenticate") {
    setStep("payment");
    return;
  }
  window.close();
});

ackInput.addEventListener("change", () => {
  paymentCta.disabled = !ackInput.checked;
});

paymentCta.addEventListener("click", async () => {
  try {
    const hasSession = await loadSession();
    if (!hasSession) return;

    const wiseUrl = state.session?.wiseUrl || "https://wise.com/all-transactions";
    await chrome.tabs.create({ url: wiseUrl });

    setStatus("Wise opened. Complete payment, then capture in Authenticate step.", "ok");
    setStep("authenticate");
  } catch (error) {
    setStatus(normalizeErrorMessage(error, "Unable to open Wise"), "error");
  }
});

refreshPaymentsBtn.addEventListener("click", async () => {
  try {
    await refreshPaymentCandidates();
  } catch (error) {
    setStatus(normalizeErrorMessage(error, "Capture failed"), "error");
  }
});

selectPaymentCta.addEventListener("click", async () => {
  try {
    const hasSession = await loadSession();
    if (!hasSession) return;
    if (state.selectedIndex == null) {
      setStatus("Select one payment first.", "error");
      return;
    }

	    const selectedPayment = state.payments[state.selectedIndex];
	    const verified = await sendMessage(MESSAGES.VERIFY_SELECTED_PAYMENT, {
	      proofId: state.proofId,
	      payment: selectedPayment
	    });

    state.selectionVerified = true;
    state.session = {
      ...state.session,
      wiseReceiptHash: verified.wiseReceiptHash,
      selectedPayment
    };
    setStep("verify");
    updateVerifyPanel(SESSION_STATUS.CAPTURE_READY, { selectedPayment, selectedVerified: true });
    setStatus("Attestation verified for selected payment. Click VERIFY PAYMENT to start proof.", "ok");
  } catch (error) {
    state.selectionVerified = false;
    setStatus(normalizeErrorMessage(error, "Selected payment verification failed"), "error");
  }
});

verifyCta.addEventListener("click", async () => {
  if (state.verifyDone) {
    const fallbackUrl = "http://localhost:3011/zkp2p-horizen-release";
    const submitEndpoint = state.session?.submitEndpoint;

    let targetUrl = fallbackUrl;
    if (submitEndpoint) {
      try {
        const parsed = new URL(submitEndpoint);
        targetUrl = `${parsed.origin}/zkp2p-horizen-release`;
      } catch {
        targetUrl = fallbackUrl;
      }
    }

    await chrome.tabs.create({ url: targetUrl });
    window.close();
    return;
  }

  await runVerificationFlow();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== MESSAGES.STATUS_EVENT) return;
  const payload = message.payload || {};

  if (state.proofId && payload.proofId !== state.proofId) return;

  const pluginStatus = payload.status || "";
  const detail = payload.detail || {};

  if (pluginStatus === SESSION_STATUS.CAPTURE_READY && detail.capture) {
    const recent = Array.isArray(detail.recentTransfers) ? detail.recentTransfers : [];
    state.payments =
      recent.length > 0
        ? recent.map((item) => normalizePayment(item, detail.capture))
        : [];
    state.selectedIndex = state.payments.length > 0 ? 0 : null;
    renderPaymentList();
    state.selectionVerified = Boolean(detail.selectedVerified);
    if (detail.preProofPreview) {
      showPreProofDump(detail.preProofPreview);
    }
    if (detail.selectedVerified && detail.wiseReceiptHash) {
      state.session = {
        ...state.session,
        wiseReceiptHash: detail.wiseReceiptHash,
        selectedPayment: detail.selectedPayment || state.payments[0]
      };
    }
  }

  if (pluginStatus === SESSION_STATUS.WISE_OPENED) {
    setStep("authenticate");
  }

  if (pluginStatus === SESSION_STATUS.PROVING || pluginStatus === SESSION_STATUS.PROOF_READY) {
    setStep("verify");
  }

  updateVerifyPanel(pluginStatus, detail);
  setStatus(`Plugin event: ${pluginStatus}`, pluginStatus === SESSION_STATUS.ERROR ? "error" : "ok");
});

(async function init() {
  paymentCta.disabled = true;
  selectPaymentCta.disabled = true;
  verifyCta.disabled = true;
  state.selectionVerified = false;

  renderPaymentList();
  setStep("payment");

  try {
    await loadSession();
  } catch (error) {
    setStatus(normalizeErrorMessage(error, "Unable to load session"), "error");
  }
})();
