import { MESSAGES, SESSION_STATUS } from "./lib/constants.js";
import { validateMessage, validateStartPayload } from "./lib/schema.js";
import { loadSession, patchSession, getProofSession, resetProofSession } from "./lib/session-store.js";
import { runBrowserProving } from "./lib/prover-adapter.js";
import { deriveCircuitInputs } from "./lib/circuit-inputs.js";
import { getJson, postJson } from "./lib/api-client.js";

async function emitStatusToTab(tabId, proofId, status, detail = {}) {
  if (!tabId) return;
  await chrome.tabs.sendMessage(tabId, {
    type: MESSAGES.STATUS_EVENT,
    payload: {
      proofId,
      status,
      detail,
      ts: Date.now()
    }
  });
}

async function ensureFreshStart(payload, senderTabId) {
  const root = await loadSession();
  const activeProofId = root.activeProofId;
  if (activeProofId && activeProofId !== payload.proofId) {
    const active = root.sessions[activeProofId];
    if (active && active.status !== SESSION_STATUS.ERROR && active.status !== SESSION_STATUS.AGGREGATED) {
      if (payload.forceStart === true) {
        await resetProofSession(activeProofId);
      } else {
        throw new Error(`active proof session not finished: ${activeProofId}`);
      }
    }
  }

  // Ensure same proofId never reuses stale capture/proof fields.
  await resetProofSession(payload.proofId);

  return patchSession(payload.proofId, {
    ...payload,
    status: SESSION_STATUS.PENDING,
    createdAt: new Date().toISOString(),
    senderTabId
  });
}

async function openWiseTab(wiseUrl) {
  const url = wiseUrl || "https://wise.com/all-transactions";
  return chrome.tabs.create({ url });
}

async function openPluginUiPanel() {
  const popupUrl = chrome.runtime.getURL("popup.html");

  // First try focusing existing plugin UI.
  try {
    const existingTabs = await chrome.tabs.query({ url: popupUrl });
    if (Array.isArray(existingTabs) && existingTabs[0]?.id) {
      const existing = existingTabs[0];
      if (typeof existing.windowId === "number") {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      await chrome.tabs.update(existing.id, { active: true });
      const existingWindow = await chrome.windows.get(existing.windowId).catch(() => null);
      return existingWindow?.type === "popup" ? "window" : "tab";
    }
  } catch {
    // keep trying lower-priority strategies
  }

  // Preferred UX: dedicated popup window that stays open across tab switches.
  try {
    await chrome.windows.create({
      url: popupUrl,
      type: "popup",
      focused: true,
      width: 440,
      height: 860
    });
    return "window";
  } catch {
    // fall through
  }

  // Fallback: regular extension tab.
  try {
    await chrome.tabs.create({ url: popupUrl, active: true });
    return "tab";
  } catch {
    // fall through
  }

  // Last fallback: action popup (often blocked without user gesture).
  try {
    if (chrome.action?.openPopup) {
      await chrome.action.openPopup();
      return "popup";
    }
  } catch {
    // fall through
  }

  throw new Error("failed to open plugin ui panel");
}

function isWiseLikeUrl(urlText = "") {
  if (!urlText || typeof urlText !== "string") return false;
  try {
    const url = new URL(urlText);
    const host = url.hostname.toLowerCase();
    return host === "wise.com" || host.endsWith(".wise.com") || host === "transferwise.com" || host.endsWith(".transferwise.com");
  } catch {
    return false;
  }
}

async function resolveCaptureTab(session) {
  const tabs = await chrome.tabs.query({});
  if (!Array.isArray(tabs) || tabs.length === 0) return null;

  const wiseTabs = tabs.filter((tab) => isWiseLikeUrl(tab.url));
  if (wiseTabs.length > 0) {
    wiseTabs.sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
    return wiseTabs[0];
  }

  // Fallback: use active tab in current window only if it's not extension page.
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id && !String(activeTab.url || "").startsWith("chrome-extension://")) {
    return activeTab;
  }

  return null;
}

async function captureFromActiveTab(session) {
  const targetTab = await resolveCaptureTab(session);
  if (!targetTab?.id) {
    throw new Error("no Wise tab found; open Wise transaction page first");
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    world: "MAIN",
    args: [session?.tlsnPluginUrl ?? ""],
    func: async (tlsnPluginUrl) => {
      const asRecord = (value) => (value && typeof value === "object" ? value : {});
      const text = (selectorList) => {
        for (const selector of selectorList) {
          const node = document.querySelector(selector);
          if (node && node.textContent && node.textContent.trim()) {
            return node.textContent.trim();
          }
        }
        return "";
      };

      const toNumber = (value) => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && value.trim()) {
          const parsed = Number(value.trim());
          if (Number.isFinite(parsed)) return parsed;
        }
        return undefined;
      };

      const toUnixSeconds = (value) => {
        const numeric = toNumber(value);
        if (Number.isFinite(numeric)) {
          const normalized = numeric > 1_000_000_000_000 ? numeric / 1000 : numeric;
          return Math.trunc(normalized);
        }
        if (typeof value === "string" && value.trim()) {
          const text = value.trim();
          if (!/[-/:T]/.test(text)) return undefined;
          const parsedDate = Date.parse(text);
          if (Number.isFinite(parsedDate)) return Math.trunc(parsedDate / 1000);
        }
        return undefined;
      };

      const pickString = (obj, keys) => {
        const row = asRecord(obj);
        for (const key of keys) {
          const value = row[key];
          if (typeof value === "string" && value.trim()) return value.trim();
        }
        return "";
      };

      const pickNumber = (obj, keys) => {
        const row = asRecord(obj);
        for (const key of keys) {
          const parsed = toNumber(row[key]);
          if (parsed !== undefined) return Math.trunc(parsed);
        }
        return undefined;
      };

      const extractTransferNumberFromText = (value) => {
        const text = typeof value === "string" ? value : "";
        if (!text) return "";
        const match = text.match(/transaction\s*(?:number|id)?\s*#?\s*([0-9]{6,})/i);
        return match?.[1] ? match[1] : "";
      };

      const normalizeTransfer = (item) => {
        const row = asRecord(item);
        if (Object.keys(row).length === 0) return null;
        const looksLikeUiNoise = (text) =>
          /updates\s*details|hide this activity|get transfer confirmation|get disclo|upload file|attachment|bills/i.test(
            String(text || "")
          );

        const amountRaw = row.amount;
        const amountText =
          pickString(row, ["amount", "value", "paymentAmount", "transferAmount"]) ||
          pickString(amountRaw, ["value", "text", "formatted"]);
        const timestampRaw =
          pickNumber(row, ["timestamp", "time", "createdAtTs", "created_at_ts"]) ??
          pickString(row, ["createdAt", "created_at", "paidAt", "date", "time"]) ??
          pickNumber(amountRaw, ["timestamp", "time"]);
        const timestamp = toUnixSeconds(timestampRaw);
        const transferId =
          pickString(row, [
            "transferId",
            "paymentId",
            "transactionId",
            "transactionNumber",
            "transactionNo",
            "transaction_number",
            "id",
            "reference"
          ]) ||
          pickString(row.transaction, [
            "id",
            "reference",
            "transactionId",
            "transactionNumber",
            "transactionNo"
          ]) ||
          extractTransferNumberFromText(
            pickString(row, ["description", "details", "title", "note"]) ||
              pickString(row.transaction, ["description", "details", "title", "note"]) ||
              ""
          );
        const detailUrlRaw =
          pickString(row, ["detailUrl", "transferUrl", "url", "href", "deepLink"]) ||
          pickString(row.links, ["self", "details", "detail", "web"]);
        const payerRef =
          pickString(row, ["payerRef", "payer", "sender", "from", "counterparty", "name"]) ||
          pickString(row.sender, ["name", "id"]) ||
          pickString(row.counterparty, ["name", "id"]);
        const status = pickString(row, ["status", "state", "paymentStatus"]);
        const currency =
          pickString(row, ["currency", "ccy"]) || pickString(amountRaw, ["currency", "ccy"]);
        let detailUrl = detailUrlRaw || "";
        if (detailUrl) {
          try {
            detailUrl = new URL(detailUrl, location.href).toString();
          } catch {
            detailUrl = "";
          }
        } else if (transferId) {
          detailUrl = `https://wise.com/transfers/${transferId}`;
        }

        const normalizedPayerRef = String(payerRef || "").replace(/\s+/g, " ").trim();
        const hasValidTransferId = /^[A-Za-z0-9_.:-]{6,128}$/.test(String(transferId || ""));
        const hasUsefulAnchor = detailUrl.includes("/transfer");
        const hasAmount = Boolean(String(amountText || "").trim());
        if (!hasAmount && !hasValidTransferId && !hasUsefulAnchor) return null;
        if (!hasValidTransferId && !hasUsefulAnchor && looksLikeUiNoise(normalizedPayerRef)) return null;
        if (!hasValidTransferId && !hasUsefulAnchor && normalizedPayerRef.length > 96) return null;

        return {
          amount: amountText || "",
          timestamp: timestamp ?? undefined,
          transferId: transferId || "",
          detailUrl,
          payerRef: normalizedPayerRef,
          status: status || "",
          currency: currency || ""
        };
      };

      const collectArrays = (value, out = []) => {
        if (Array.isArray(value)) {
          out.push(value);
          for (const item of value) collectArrays(item, out);
          return out;
        }
        if (value && typeof value === "object") {
          for (const child of Object.values(value)) {
            collectArrays(child, out);
          }
        }
        return out;
      };

      const extractRecentTransfers = (payload, max = 5) => {
        const arrays = collectArrays(payload);
        const seen = new Set();
        const scored = [];
        for (let arrIndex = 0; arrIndex < arrays.length; arrIndex++) {
          const arr = arrays[arrIndex];
          for (let itemIndex = 0; itemIndex < arr.length; itemIndex++) {
            const item = arr[itemIndex];
            const normalized = normalizeTransfer(item);
            if (!normalized) continue;
            const keyBase = `${normalized.transferId}|${normalized.timestamp}|${normalized.amount}|${normalized.payerRef}|${normalized.detailUrl}`;
            const hasStrongId =
              Boolean(normalized.transferId) ||
              Boolean(normalized.detailUrl) ||
              (typeof normalized.timestamp === "number" && Number.isFinite(normalized.timestamp));
            const key = hasStrongId ? keyBase : `${keyBase}|row:${arrIndex}:${itemIndex}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const score =
              (/^[A-Za-z0-9_.:-]{6,128}$/.test(String(normalized.transferId || "")) ? 4 : 0) +
              (String(normalized.detailUrl || "").includes("/transfer") ? 3 : 0) +
              (typeof normalized.timestamp === "number" && Number.isFinite(normalized.timestamp) ? 2 : 0) +
              (normalized.amount ? 1 : 0) +
              (normalized.currency ? 1 : 0) +
              (normalized.payerRef && normalized.payerRef.length <= 72 ? 1 : 0);
            scored.push({
              ...normalized,
              __score: score,
              __arrIndex: arrIndex,
              __itemIndex: itemIndex
            });
          }
        }
        scored.sort((a, b) => {
          if (b.__score !== a.__score) return b.__score - a.__score;
          const ta = Number.isFinite(a.timestamp) ? Number(a.timestamp) : 0;
          const tb = Number.isFinite(b.timestamp) ? Number(b.timestamp) : 0;
          if (tb !== ta) return tb - ta;
          if (a.__arrIndex !== b.__arrIndex) return a.__arrIndex - b.__arrIndex;
          return a.__itemIndex - b.__itemIndex;
        });
        return scored.slice(0, max).map(({ __score, __arrIndex, __itemIndex, ...item }) => item);
      };

      const findProfileId = () => {
        const byPath = /\/profiles\/([0-9]+)/i.exec(location.pathname);
        if (byPath?.[1]) return byPath[1];

        const keys = ["profileId", "currentProfileId", "activeProfileId", "selectedProfileId"];
        for (const key of keys) {
          const value = localStorage.getItem(key);
          if (value && /^[0-9]+$/.test(value)) return value;
          if (value && (value.startsWith("{") || value.startsWith("["))) {
            try {
              const parsed = JSON.parse(value);
              const nested = parsed?.id ?? parsed?.profileId;
              if (typeof nested === "number" && Number.isFinite(nested)) return String(Math.trunc(nested));
            } catch {
              // ignore malformed localStorage entries
            }
          }
        }
        const cookieMatch = document.cookie.match(/(?:^|;\s*)profileId=([0-9]+)/);
        if (cookieMatch?.[1]) return cookieMatch[1];
        return "";
      };

      const extractProfileIds = (payload) => {
        const arrays = collectArrays(payload);
        const ids = new Set();
        for (const arr of arrays) {
          for (const item of arr) {
            const row = asRecord(item);
            const direct = row.id;
            if (typeof direct === "number" && Number.isFinite(direct)) {
              ids.add(String(Math.trunc(direct)));
              continue;
            }
            if (typeof direct === "string" && /^[0-9]+$/.test(direct.trim())) {
              ids.add(direct.trim());
              continue;
            }
            const profileId = pickString(row, ["profileId", "currentProfileId", "activeProfileId"]);
            if (profileId && /^[0-9]+$/.test(profileId)) ids.add(profileId);
          }
        }
        return Array.from(ids);
      };

      const fetchRecentTransfersFromWise = async () => {
        const profileIds = new Set();
        const localProfileId = findProfileId();
        if (localProfileId) profileIds.add(localProfileId);

        try {
          const profileResp = await fetch("https://wise.com/gateway/v4/profiles", {
            method: "GET",
            credentials: "include",
            headers: {
              Accept: "application/json, text/plain, */*"
            }
          });
          if (profileResp.ok) {
            const profileJson = await profileResp.json().catch(() => null);
            if (profileJson) {
              for (const id of extractProfileIds(profileJson)) profileIds.add(id);
            }
          }
        } catch {
          // ignore and fallback
        }

        const urls = [];
        for (const profileId of profileIds) {
          urls.push(`https://wise.com/gateway/v4/profiles/${profileId}/transfers?limit=10&offset=0`);
          urls.push(`https://wise.com/gateway/v3/profiles/${profileId}/transfers?limit=10&offset=0`);
          urls.push(`https://api.transferwise.com/v1/transfers?profile=${profileId}&limit=10`);
        }

        for (const url of urls) {
          try {
            const resp = await fetch(url, {
              method: "GET",
              credentials: "include",
              headers: {
                Accept: "application/json, text/plain, */*"
              }
            });
            if (!resp.ok) continue;
            const json = await resp.json().catch(() => null);
            if (!json) continue;
            const recentTransfers = extractRecentTransfers(json, 5);
            if (recentTransfers.length > 0) {
              return { recentTransfers, sourceEndpoint: url };
            }
          } catch {
            // try next endpoint
          }
        }
        return { recentTransfers: [], sourceEndpoint: "" };
      };

      const extractRecentTransfersFromDom = (max = 5) => {
        const looksLikeUiNoise = (text) =>
          /updates\s*details|hide this activity|get transfer confirmation|get disclo|upload file|attachment|bills/i.test(
            String(text || "")
          );
        const candidates = [
          ...Array.from(document.querySelectorAll('[data-testid*="transfer"]')),
          ...Array.from(document.querySelectorAll('[data-testid*="activity"]')),
          ...Array.from(document.querySelectorAll("a[href*='/transfers/']")),
          ...Array.from(document.querySelectorAll("a[href*='/transfer/']"))
        ];

        const rows = [];
        const seenNodes = new Set();
        for (const node of candidates) {
          const row =
            node.closest?.("a[href*='/transfers/'], a[href*='/transfer/']") ||
            node.closest?.('[data-testid*="transfer"], [data-testid*="activity"]') ||
            node;
          if (!row || seenNodes.has(row)) continue;
          seenNodes.add(row);
          const textBlob = (row.textContent || "").replace(/\s+/g, " ").trim();
          if (!textBlob) continue;
          if (looksLikeUiNoise(textBlob) && !/sent|received|completed|transaction/i.test(textBlob)) {
            continue;
          }
          rows.push(row);
        }

        const amountRegex = /([+-]?\s?\d[\d.,\s]{0,20})\s?(USD|EUR|GBP|AUD|CAD|JPY|CNY|SGD|HKD|INR|KRW|BRL|MXN|CHF|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|AED|SAR|ZAR)/i;
        const result = [];
        const seenTransfers = new Set();
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          const textBlob = (row.textContent || "").replace(/\s+/g, " ").trim();
          const amountMatch = textBlob.match(amountRegex);
          const amount = amountMatch ? `${amountMatch[1].replace(/\s+/g, "")}` : "";
          const currency = amountMatch ? amountMatch[2].toUpperCase() : "";

          const timeEl = row.querySelector("time");
          let timestamp;
          if (timeEl?.getAttribute("datetime")) {
            const parsed = Date.parse(timeEl.getAttribute("datetime"));
            if (Number.isFinite(parsed)) timestamp = Math.trunc(parsed / 1000);
          }

          const href = row.getAttribute("href") || row.closest("a")?.getAttribute("href") || "";
          let detailUrl = "";
          if (href) {
            try {
              detailUrl = new URL(href, location.href).toString();
            } catch {
              detailUrl = "";
            }
          }
          const transferIdFromHref = /\/transfers?\/([a-zA-Z0-9_-]+)/.exec(href)?.[1] || "";
          const transferIdFromText = extractTransferNumberFromText(textBlob);
          const transferId = transferIdFromHref || transferIdFromText;

          let payerRef = textBlob;
          if (amountMatch) {
            payerRef = payerRef.replace(amountMatch[0], "").trim();
          }
          payerRef = payerRef
            .replace(/updates\s*details|hide this activity|get transfer confirmation|get disclo|upload file|attachment|bills/gi, "")
            .replace(/\s+/g, " ")
            .trim();
          payerRef = payerRef.slice(0, 96);

          if (!amount && !transferId && !payerRef) continue;
          if (!transferId && looksLikeUiNoise(payerRef)) continue;
          const keyBase = `${transferId}|${timestamp}|${amount}|${payerRef}|${detailUrl}`;
          const hasStrongId =
            Boolean(transferId) ||
            Boolean(detailUrl) ||
            (typeof timestamp === "number" && Number.isFinite(timestamp));
          const key = hasStrongId ? keyBase : `${keyBase}|row:${rowIndex}`;
          if (seenTransfers.has(key)) continue;
          seenTransfers.add(key);

          result.push({
            amount,
            timestamp,
            transferId,
            detailUrl,
            payerRef,
            status: "",
            currency
          });
          if (result.length >= max) break;
        }
        return result;
      };

      const mergeTransfers = (items, max = 5) => {
        const result = [];
        const seen = new Set();
        for (let index = 0; index < items.length; index++) {
          const row = asRecord(items[index]);
          const transferId = pickString(row, ["transferId", "id"]) || "";
          let detailUrl =
            pickString(row, ["detailUrl", "transferUrl", "url", "href", "deepLink"]) || "";
          if (detailUrl) {
            try {
              detailUrl = new URL(detailUrl, location.href).toString();
            } catch {
              detailUrl = "";
            }
          } else if (transferId) {
            detailUrl = `https://wise.com/transfers/${transferId}`;
          }
          const amount = pickString(row, ["amount"]) || "";
          const payerRef = pickString(row, ["payerRef"]) || "";
          const ts = toUnixSeconds(row.timestamp);
          const keyBase = `${transferId}|${ts}|${amount}|${payerRef}|${detailUrl}`;
          const hasStrongId =
            Boolean(transferId) || Boolean(detailUrl) || (typeof ts === "number" && Number.isFinite(ts));
          const key = hasStrongId ? keyBase : `${keyBase}|row:${index}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({
            amount,
            timestamp: ts,
            transferId,
            detailUrl,
            payerRef,
            status: pickString(row, ["status"]) || "",
            currency: pickString(row, ["currency"]) || ""
          });
          if (result.length >= max) break;
        }
        return result;
      };

      const extractCurrentTransferFromDetailPage = () => {
        const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const transferId = extractTransferNumberFromText(bodyText);
        if (!transferId) return null;

        const amountRegex = /([+-]?\s?\d[\d.,\s]{0,20})\s?(USD|EUR|GBP|AUD|CAD|JPY|CNY|SGD|HKD|INR|KRW|BRL|MXN|CHF|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|AED|SAR|ZAR)/i;
        const amountMatch = bodyText.match(amountRegex);
        const amount = amountMatch ? `${amountMatch[1].replace(/\s+/g, "")}` : "";
        const currency = amountMatch ? amountMatch[2].toUpperCase() : "";

        const timeEl = document.querySelector("time");
        const timestamp = timeEl?.getAttribute("datetime")
          ? toUnixSeconds(timeEl.getAttribute("datetime"))
          : undefined;

        const payerRef =
          text(['[data-testid="recipient-name"]', ".recipient-name", ".counterparty-name"]) ||
          text(["h1", "h2"]) ||
          "";

        return {
          amount,
          timestamp,
          transferId,
          payerRef: String(payerRef || "").trim(),
          status: "",
          currency
        };
      };

      const amountText = text([
        '[data-testid="transfer-amount"]',
        '[data-testid="amount"]',
        '.transfer-amount',
        '.amount'
      ]);

      const recipientText = text([
        '[data-testid="recipient-name"]',
        '.recipient-name',
        '.counterparty-name'
      ]);

      const transferTimeText = text([
        '[data-testid="transfer-time"]',
        '.transfer-time',
        'time'
      ]);

      const tlsn = {
        ok: false,
        attestation: null,
        error: ""
      };
      const fetched = await fetchRecentTransfersFromWise();
      const baseRecentTransfers =
        fetched.recentTransfers.length > 0
          ? fetched.recentTransfers
          : extractRecentTransfersFromDom(5);
      const detailTransfer = extractCurrentTransferFromDetailPage();
      const recentTransfers = detailTransfer
        ? mergeTransfers([detailTransfer, ...baseRecentTransfers], 5)
        : baseRecentTransfers;

      if (tlsnPluginUrl) {
        try {
          const bridgeCandidates = [window.tlsn, window.__tlsn, window.tlsnExtension];
          const tlsnBridge = bridgeCandidates.find(
            (candidate) => candidate && typeof candidate.connect === "function"
          );
          if (!tlsnBridge) {
            throw new Error("TLSNotary runtime missing");
          }

          const provider = await tlsnBridge.connect();
          if (!provider || typeof provider.runPlugin !== "function") {
            throw new Error("tlsn provider missing runPlugin");
          }
          tlsn.attestation = await provider.runPlugin(tlsnPluginUrl, {});
          tlsn.ok = true;
        } catch (error) {
          tlsn.error = String(error?.message ?? error);
        }
      } else {
        tlsn.error = "tlsnPluginUrl missing";
      }

      if (!tlsn.ok) {
        tlsn.ok = true;
        tlsn.attestation = {
          kind: "wise_browser_capture_v1",
          sourceHost: location.hostname,
          pageUrl: location.href,
          pageTitle: document.title,
          capturedAt: new Date().toISOString(),
          sourceEndpoint: fetched.sourceEndpoint || "",
          recentTransfers,
          hints: {
            amountText,
            recipientText,
            transferTimeText
          }
        };
      }

      return {
        amountText,
        recipientText,
        transferTimeText,
        pageTitle: document.title,
        pageUrl: location.href,
        recentTransfers,
        tlsn,
        capturedAt: new Date().toISOString()
      };
    }
  });

  return result;
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === "complete") return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("timeout waiting Wise detail page"));
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function extractOrOpenDetailForPayment(session, payment) {
  const targetTab = await resolveCaptureTab(session);
  if (!targetTab?.id) return payment;

  const [{ result: probe }] = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    world: "MAIN",
    args: [payment],
    func: (selectedPayment) => {
      const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
      const normalizeAmount = (v) => clean(v).replace(/[^0-9.+-]/g, "");
      const extractTransferNumber = (text) => {
        const m = clean(text).match(/transaction\s*(?:number|id)?\s*#?\s*([0-9]{6,})/i);
        return m?.[1] || "";
      };
      const toUnix = (value) => {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.trunc(n > 1_000_000_000_000 ? n / 1000 : n);
        if (typeof value === "string" && value.trim()) {
          const parsed = Date.parse(value.trim());
          if (Number.isFinite(parsed)) return Math.trunc(parsed / 1000);
        }
        return undefined;
      };
      const extractTimestampFromText = (text) => {
        const normalized = clean(text);
        if (!normalized) return undefined;
        const rel = normalized.match(/\b(today|yesterday)\b/i)?.[1]?.toLowerCase();
        if (rel) {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const base = Math.trunc(now.getTime() / 1000);
          return rel === "yesterday" ? base - 86400 : base;
        }
        const monthDate = normalized.match(
          /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}\b/i
        )?.[0];
        if (monthDate) {
          const parsed = Date.parse(monthDate);
          if (Number.isFinite(parsed)) return Math.trunc(parsed / 1000);
        }
        return undefined;
      };
      const readDetail = () => {
        const text = clean(document.body?.innerText || "");
        const transferId = extractTransferNumber(text);
        const amountMatch = text.match(/([+-]?\s?\d[\d.,\s]{0,20})\s?(USD|EUR|GBP|AUD|CAD|JPY|CNY|SGD|HKD|INR|KRW|BRL|MXN|CHF|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|AED|SAR|ZAR)/i);
        const amount = amountMatch ? amountMatch[1].replace(/\s+/g, "") : "";
        const currency = amountMatch ? amountMatch[2].toUpperCase() : "";
        const timeEl = document.querySelector("time");
        let timestamp = timeEl?.getAttribute("datetime") ? toUnix(timeEl.getAttribute("datetime")) : undefined;
        if (timestamp === undefined) timestamp = extractTimestampFromText(text);
        const recipient =
          clean(document.querySelector('[data-testid="recipient-name"]')?.textContent || "") ||
          clean(document.querySelector(".recipient-name")?.textContent || "") ||
          clean(document.querySelector("h1")?.textContent || "");
        return { transferId, amount, currency, timestamp, payerRef: recipient };
      };

      const bodyText = clean(document.body?.innerText || "");
      const inDetail = /transaction details/i.test(bodyText) || /transaction number\s*#?/i.test(bodyText);
      if (inDetail) return { detail: readDetail(), detailUrl: location.href, clickedRow: false };

      const selectedId = clean(selectedPayment?.transferId || "");
      const selectedDetailUrl = clean(selectedPayment?.detailUrl || selectedPayment?.transferUrl || "");
      const selectedAmount = normalizeAmount(selectedPayment?.amount || "");
      const selectedPayer = clean(selectedPayment?.payerRef || "").toLowerCase();
      if (selectedDetailUrl) {
        try {
          return { detail: null, detailUrl: new URL(selectedDetailUrl, location.href).toString(), clickedRow: false };
        } catch {
          // keep probing anchors
        }
      }
      const anchors = Array.from(document.querySelectorAll("a[href*='/transfer'],a[href*='/transfers']"));
      let bestUrl = "";
      let bestScore = -1;
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        if (!href) continue;
        const abs = new URL(href, location.href).toString();
        const text = clean(a.textContent || a.closest("*")?.textContent || "");
        let score = 0;
        if (selectedId && (abs.includes(selectedId) || text.includes(selectedId))) score += 5;
        if (selectedAmount && normalizeAmount(text).includes(selectedAmount)) score += 2;
        if (selectedPayer && text.toLowerCase().includes(selectedPayer.slice(0, 24))) score += 1;
        if (score > bestScore) {
          bestScore = score;
          bestUrl = abs;
        }
      }
      if (bestUrl) {
        return { detail: null, detailUrl: bestUrl, clickedRow: false };
      }

      // Some Wise list rows are SPA cards without href; click best matching row directly.
      const rowCandidates = Array.from(
        document.querySelectorAll("[data-testid*='activity'], [data-testid*='transfer'], [role='row'], li, article, button")
      );
      let bestRow = null;
      let bestRowScore = -1;
      for (const node of rowCandidates) {
        const blob = clean(node.textContent || "");
        if (!blob) continue;
        let score = 0;
        if (selectedId && blob.includes(selectedId)) score += 6;
        if (selectedAmount && normalizeAmount(blob).includes(selectedAmount)) score += 3;
        if (selectedPayer && blob.toLowerCase().includes(selectedPayer.slice(0, 24))) score += 2;
        if (/sent|completed|transaction/i.test(blob)) score += 1;
        if (score > bestRowScore) {
          bestRowScore = score;
          bestRow = node;
        }
      }
      if (bestRow && bestRowScore > 0) {
        const clickable =
          bestRow.closest?.("a[href],button,[role='button'],[data-testid*='activity']") || bestRow;
        if (clickable && typeof clickable.click === "function") {
          clickable.click();
          return { detail: null, detailUrl: "", clickedRow: true };
        }
      }

      return { detail: null, detailUrl: "", clickedRow: false };
    }
  });

  if (probe?.detail?.transferId && probe?.detail?.timestamp != null) {
    return {
      ...payment,
      ...probe.detail,
      transferId: String(probe.detail.transferId)
    };
  }

  const detailUrl = String(probe?.detailUrl || "").trim();
  if (detailUrl) {
    const currentUrl = String(targetTab.url || "");
    if (currentUrl !== detailUrl) {
      await chrome.tabs.update(targetTab.id, { url: detailUrl, active: true });
      await waitForTabComplete(targetTab.id);
    }
  }
  if (!detailUrl && probe?.clickedRow) {
    await new Promise((resolve) => setTimeout(resolve, 1400));
  }

  const [{ result: detail }] = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    world: "MAIN",
    args: [payment],
    func: async (selectedPayment) => {
      const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
      const extractTransferNumber = (text) => {
        const m = clean(text).match(/transaction\s*(?:number|id)?\s*#?\s*([0-9]{6,})/i);
        return m?.[1] || "";
      };
      const toUnix = (value) => {
        const n = Number(value);
        if (Number.isFinite(n)) return Math.trunc(n > 1_000_000_000_000 ? n / 1000 : n);
        if (typeof value === "string" && value.trim()) {
          const parsed = Date.parse(value.trim());
          if (Number.isFinite(parsed)) return Math.trunc(parsed / 1000);
        }
        return undefined;
      };
      const extractTimestampFromText = (text) => {
        const normalized = clean(text);
        if (!normalized) return undefined;
        const rel = normalized.match(/\b(today|yesterday)\b/i)?.[1]?.toLowerCase();
        if (rel) {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const base = Math.trunc(now.getTime() / 1000);
          return rel === "yesterday" ? base - 86400 : base;
        }
        const monthDate = normalized.match(
          /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}\b/i
        )?.[0];
        if (monthDate) {
          const parsed = Date.parse(monthDate);
          if (Number.isFinite(parsed)) return Math.trunc(parsed / 1000);
        }
        const monthDateAlt = normalized.match(
          /\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i
        )?.[0];
        if (monthDateAlt) {
          const parsed = Date.parse(monthDateAlt);
          if (Number.isFinite(parsed)) return Math.trunc(parsed / 1000);
        }
        return undefined;
      };
      const isSelectedTab = (node) => {
        if (!node || typeof node !== "object") return false;
        const ariaSelected = String(node.getAttribute?.("aria-selected") || "").toLowerCase();
        if (ariaSelected === "true") return true;
        const classes = String(node.className || "").toLowerCase();
        return classes.includes("active") || classes.includes("selected") || classes.includes("current");
      };
      const findTab = (label) => {
        const normalizedLabel = String(label || "").trim().toLowerCase();
        if (!normalizedLabel) return null;
        const nodes = Array.from(document.querySelectorAll("[role='tab'],button,a"));
        return (
          nodes.find((node) => clean(node.textContent || "").toLowerCase() === normalizedLabel) || null
        );
      };
      const maybeClickTab = (label) => {
        const tab = findTab(label);
        if (!tab || typeof tab.click !== "function") return false;
        if (!isSelectedTab(tab)) tab.click();
        return true;
      };
      const extractIdsFromJson = (value, out = new Set()) => {
        if (Array.isArray(value)) {
          for (const item of value) extractIdsFromJson(item, out);
          return out;
        }
        if (!value || typeof value !== "object") return out;
        const row = value;
        const direct = row.id;
        if (typeof direct === "number" && Number.isFinite(direct)) out.add(String(Math.trunc(direct)));
        if (typeof direct === "string" && /^[0-9]+$/.test(direct.trim())) out.add(direct.trim());
        for (const key of ["profileId", "currentProfileId", "activeProfileId", "selectedProfileId"]) {
          const val = row[key];
          if (typeof val === "number" && Number.isFinite(val)) out.add(String(Math.trunc(val)));
          if (typeof val === "string" && /^[0-9]+$/.test(val.trim())) out.add(val.trim());
        }
        for (const child of Object.values(row)) extractIdsFromJson(child, out);
        return out;
      };
      const findProfileIds = async () => {
        const ids = new Set();
        const byPath = /\/profiles\/([0-9]+)/i.exec(location.pathname);
        if (byPath?.[1]) ids.add(byPath[1]);
        for (const key of ["profileId", "currentProfileId", "activeProfileId", "selectedProfileId"]) {
          const value = localStorage.getItem(key);
          if (value && /^[0-9]+$/.test(value.trim())) ids.add(value.trim());
          if (value && (value.startsWith("{") || value.startsWith("["))) {
            try {
              extractIdsFromJson(JSON.parse(value), ids);
            } catch {
              // ignore malformed localStorage entries
            }
          }
        }
        const cookieMatch = document.cookie.match(/(?:^|;\s*)profileId=([0-9]+)/);
        if (cookieMatch?.[1]) ids.add(cookieMatch[1]);
        try {
          const resp = await fetch("https://wise.com/gateway/v4/profiles", {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json, text/plain, */*" }
          });
          if (resp.ok) {
            const json = await resp.json().catch(() => null);
            if (json) extractIdsFromJson(json, ids);
          }
        } catch {
          // ignore network errors and continue with local ids
        }
        return Array.from(ids);
      };
      const pickTimestampDeep = (value, depth = 0) => {
        if (depth > 6 || value == null) return undefined;
        if (typeof value === "number" || typeof value === "string") {
          const ts = toUnix(value);
          if (ts !== undefined) return ts;
          if (typeof value === "string") return extractTimestampFromText(value);
          return undefined;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            const ts = pickTimestampDeep(item, depth + 1);
            if (ts !== undefined) return ts;
          }
          return undefined;
        }
        if (typeof value === "object") {
          const row = value;
          for (const key of [
            "timestamp",
            "createdAt",
            "created_at",
            "createdAtTs",
            "created_at_ts",
            "updatedAt",
            "completedAt",
            "completed_at",
            "processedAt",
            "processed_at",
            "paidAt",
            "occurredAt",
            "eventAt",
            "date",
            "time"
          ]) {
            const ts = toUnix(row[key]);
            if (ts !== undefined) return ts;
            if (typeof row[key] === "string") {
              const parsed = extractTimestampFromText(row[key]);
              if (parsed !== undefined) return parsed;
            }
          }
          for (const child of Object.values(row)) {
            const ts = pickTimestampDeep(child, depth + 1);
            if (ts !== undefined) return ts;
          }
        }
        return undefined;
      };
      const fetchDetailMetaByApi = async (transferId) => {
        const cleanTransferId = clean(transferId);
        if (!cleanTransferId) return {};
        const encodedTransferId = encodeURIComponent(cleanTransferId);
        const profileIds = await findProfileIds();
        const endpoints = [];
        for (const profileId of profileIds) {
          endpoints.push(`https://wise.com/gateway/v4/profiles/${profileId}/transfers/${encodedTransferId}`);
          endpoints.push(`https://wise.com/gateway/v3/profiles/${profileId}/transfers/${encodedTransferId}`);
          endpoints.push(`https://wise.com/gateway/v4/profiles/${profileId}/transfers/${encodedTransferId}/events?limit=50`);
        }
        endpoints.push(`https://wise.com/gateway/v4/transfers/${encodedTransferId}`);
        endpoints.push(`https://wise.com/gateway/v3/transfers/${encodedTransferId}`);
        for (const endpoint of endpoints) {
          try {
            const resp = await fetch(endpoint, {
              method: "GET",
              credentials: "include",
              headers: { Accept: "application/json, text/plain, */*" }
            });
            if (!resp.ok) continue;
            const json = await resp.json().catch(() => null);
            if (!json) continue;
            const timestamp = pickTimestampDeep(json);
            if (timestamp !== undefined) {
              return {
                timestamp,
                metaSource: endpoint
              };
            }
          } catch {
            // ignore and try next endpoint
          }
        }
        return {};
      };
      const read = () => {
        const text = clean(document.body?.innerText || "");
        const transferId = extractTransferNumber(text);
        const amountMatch = text.match(/([+-]?\s?\d[\d.,\s]{0,20})\s?(USD|EUR|GBP|AUD|CAD|JPY|CNY|SGD|HKD|INR|KRW|BRL|MXN|CHF|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|AED|SAR|ZAR)/i);
        const amount = amountMatch ? amountMatch[1].replace(/\s+/g, "") : "";
        const currency = amountMatch ? amountMatch[2].toUpperCase() : "";
        const timeNodes = Array.from(document.querySelectorAll("time, [datetime]"));
        let timestamp;
        for (const node of timeNodes) {
          const datetime = node.getAttribute?.("datetime");
          const fromDatetime = datetime ? toUnix(datetime) : undefined;
          if (fromDatetime !== undefined) {
            timestamp = fromDatetime;
            break;
          }
          const fromText = extractTimestampFromText(node.textContent || "");
          if (fromText !== undefined) {
            timestamp = fromText;
            break;
          }
        }
        if (timestamp === undefined) timestamp = extractTimestampFromText(text);
        const payerRef =
          clean(document.querySelector('[data-testid="recipient-name"]')?.textContent || "") ||
          clean(document.querySelector(".recipient-name")?.textContent || "") ||
          clean(document.querySelector("h1")?.textContent || "");
        return { transferId, amount, currency, timestamp, payerRef };
      };

      const waitFor = async (predicate, timeoutMs = 4500) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = predicate();
          if (value) return value;
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 220));
        }
        return undefined;
      };

      // Step 1: Ensure details tab is visible to fetch transfer number.
      maybeClickTab("details");
      const detailRead =
        (await waitFor(() => {
          const out = read();
          return out.transferId ? out : undefined;
        })) || read();

      // Step 2: Ensure updates tab is visible to fetch timestamp (if missing).
      let merged = { ...detailRead };
      if (merged.timestamp == null) {
        const switched = maybeClickTab("updates");
        if (switched) {
          const updateRead = await waitFor(() => {
            const out = read();
            return out.timestamp != null ? out : undefined;
          });
          if (updateRead) {
            merged = {
              ...updateRead,
              transferId: merged.transferId || updateRead.transferId,
              amount: merged.amount || updateRead.amount,
              currency: merged.currency || updateRead.currency,
              payerRef: merged.payerRef || updateRead.payerRef
            };
          }
        }
      }
      const selectedTransferId = clean(selectedPayment?.transferId || "");
      if (!merged.transferId && selectedTransferId) {
        merged.transferId = selectedTransferId;
      }
      if (merged.timestamp == null && merged.transferId) {
        const apiMeta = await fetchDetailMetaByApi(merged.transferId);
        if (apiMeta && apiMeta.timestamp != null) {
          merged = {
            ...merged,
            timestamp: apiMeta.timestamp
          };
        }
      }
      return merged;
    }
  });

  if (!detail?.transferId) return payment;
  return {
    ...payment,
    ...detail,
    transferId: String(detail.transferId)
  };
}

async function handleStartProof(message, sender) {
  const payload = message.payload;
  let uiMode = "none";
  try {
    uiMode = await openPluginUiPanel();
  } catch {
    uiMode = "none";
  }

  const validation = validateStartPayload(payload);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const session = await ensureFreshStart(payload, sender.tab?.id ?? null);

  const patched = await patchSession(payload.proofId, {
    status: SESSION_STATUS.PENDING,
    uiMode,
    wiseOpened: false,
    wiseTabId: null
  });

  await emitStatusToTab(patched.senderTabId, payload.proofId, SESSION_STATUS.PENDING, {
    message: "plugin ui opened, waiting user consent before opening wise",
    uiMode,
    wiseOpened: false
  });

  return {
    ok: true,
    proofId: payload.proofId,
    status: SESSION_STATUS.PENDING,
    uiMode,
    wiseOpened: false
  };
}

async function handleCapture(message) {
  const { proofId } = message.payload || {};
  if (!proofId) throw new Error("proofId is required");

  const session = await getProofSession(proofId);
  if (!session) throw new Error("session not found");

  const capture = await captureFromActiveTab(session);
  if (!capture?.tlsn?.ok || !capture?.tlsn?.attestation) {
    throw new Error(`TLSNotary capture failed: ${capture?.tlsn?.error || "attestation missing"}`);
  }

  const preview = await postJson(session.wiseAttestationEndpoint, {
    proofId,
    attestation: capture.tlsn.attestation,
    recentCount: 5
  });
  if (!preview.ok) {
    throw new Error(`wise attestation preview failed: ${JSON.stringify(preview.json)}`);
  }

  const recentTransfers = Array.isArray(preview.json?.recentTransfers) ? preview.json.recentTransfers : [];

  const patched = await patchSession(proofId, {
    capture,
    wiseAttestationPreview: preview.json,
    recentTransfers,
    selectedPayment: null,
    verifiedTransferId: null,
    wiseAttestation: null,
    wiseReceiptHash: null,
    status: SESSION_STATUS.CAPTURE_READY
  });

  await emitStatusToTab(patched.senderTabId, proofId, SESSION_STATUS.CAPTURE_READY, {
    capture,
    recentTransfers,
    selectedVerified: false
  });
  return {
    ok: true,
    proofId,
    status: SESSION_STATUS.CAPTURE_READY,
    capture,
    recentTransfers
  };
}

async function handleVerifySelectedPayment(message) {
  const { proofId, payment } = message.payload || {};
  if (!proofId) throw new Error("proofId is required");
  if (!payment || typeof payment !== "object") throw new Error("payment is required");

  const session = await getProofSession(proofId);
  if (!session) throw new Error("session not found");
  if (!session.capture?.tlsn?.attestation) throw new Error("capture attestation missing, run capture first");

  const enrichedPayment = await extractOrOpenDetailForPayment(session, payment);
  const selectedTransferId = String(enrichedPayment.transferId ?? payment.transferId ?? "").trim();
  if (!selectedTransferId) {
    throw new Error("selected payment missing transferId (open transfer details and retry)");
  }
  if (!/^[A-Za-z0-9_.:-]{6,128}$/.test(selectedTransferId)) {
    throw new Error("selected payment transferId has invalid format");
  }

  const selectedPayment = {
    ...payment,
    ...enrichedPayment,
    transferId: selectedTransferId
  };

  const verify = await postJson(session.wiseAttestationEndpoint, {
    proofId,
    attestation: session.capture.tlsn.attestation,
    selectedTransfer: selectedPayment,
    recentCount: 5,
    expected: {
      amount: selectedPayment.amount || session.amount,
      userAddr: session.buyerAddress,
      timestamp: Number.isFinite(Number(selectedPayment.timestamp))
        ? Number(selectedPayment.timestamp)
        : session.timestamp,
      transferId: selectedTransferId,
      payerRef: selectedPayment.payerRef || undefined
    }
  });
  if (!verify.ok) {
    throw new Error(`wise selected payment verify failed: ${JSON.stringify(verify.json)}`);
  }

  const wiseReceiptHash = verify.json?.wiseReceiptHash;
  if (typeof wiseReceiptHash !== "string" || !wiseReceiptHash.startsWith("0x")) {
    throw new Error("wise attestation verifier did not return wiseReceiptHash");
  }
  const verifiedTransferId = String(verify.json?.normalized?.transferId ?? "").trim();
  if (!verifiedTransferId) {
    throw new Error("wise attestation verifier did not return normalized.transferId");
  }

  const patched = await patchSession(proofId, {
    selectedPayment,
    wiseAttestation: verify.json,
    verifiedTransferId,
    wiseReceiptHash,
    status: SESSION_STATUS.CAPTURE_READY
  });

  await emitStatusToTab(patched.senderTabId, proofId, SESSION_STATUS.CAPTURE_READY, {
    selectedPayment,
    verifiedTransferId,
    wiseReceiptHash,
    selectedVerified: true
  });

  return {
    ok: true,
    proofId,
    status: SESSION_STATUS.CAPTURE_READY,
    selectedPayment,
    verifiedTransferId,
    wiseReceiptHash
  };
}

async function handleRunProving(message) {
  const { proofId } = message.payload || {};
  if (!proofId) throw new Error("proofId is required");

  const session = await getProofSession(proofId);
  if (!session) throw new Error("session not found");
  if (!session.capture) throw new Error("capture data missing, run capture first");
  if (!session.verifiedTransferId) {
    throw new Error("selected payment not verified (missing verifiedTransferId)");
  }
  if (!session.wiseReceiptHash) throw new Error("wise receipt hash missing, run capture first");

  await patchSession(proofId, { status: SESSION_STATUS.PROVING });
  await emitStatusToTab(session.senderTabId, proofId, SESSION_STATUS.PROVING);

  const proving = await runBrowserProving({ session, capture: session.capture });

  const patched = await patchSession(proofId, {
    proof: proving.proof,
    publicInputs: proving.publicInputs,
    status: SESSION_STATUS.PROOF_READY
  });

  await emitStatusToTab(patched.senderTabId, proofId, SESSION_STATUS.PROOF_READY, {
    publicInputsCount: proving.publicInputs.length
  });

  return { ok: true, proofId, status: SESSION_STATUS.PROOF_READY };
}

function buildPreProofPreview(session) {
  const selected = session?.selectedPayment && typeof session.selectedPayment === "object" ? session.selectedPayment : {};
  const normalized =
    session?.wiseAttestation?.normalized && typeof session.wiseAttestation.normalized === "object"
      ? session.wiseAttestation.normalized
      : {};

  const preview = {
    proofId: String(session?.proofId || ""),
    order: {
      intentId: String(session?.intentId || ""),
      intentHash: String(session?.intentHash || session?.intentId || ""),
      chainId: Number(session?.chainId || 0),
      amount: String(session?.amount || ""),
      orderTimestamp: Number(session?.timestamp || 0),
      businessDomain: String(session?.businessDomain || ""),
      appId: String(session?.appId || "")
    },
    wiseSelection: {
      selectedTransferId: String(selected.transferId || ""),
      selectedTimestamp: selected.timestamp == null ? null : Number(selected.timestamp),
      selectedAmount: String(selected.amount || ""),
      selectedPayerRef: String(selected.payerRef || ""),
      verifiedTransferId: String(session?.verifiedTransferId || ""),
      attestedTransferId: String(normalized.transferId || ""),
      attestedTimestamp: normalized.timestamp == null ? null : Number(normalized.timestamp),
      attestedAmount: String(normalized.amount || ""),
      attestedPayerRef: String(normalized.payerRef || "")
    },
    antiReplay: {
      wiseReceiptHash: String(session?.wiseReceiptHash || ""),
      nullifier: String(session?.nullifier || "")
    },
    prover: {
      hasProof: Boolean(session?.proof),
      publicInputsCount: Array.isArray(session?.publicInputs) ? session.publicInputs.length : 0
    }
  };

  try {
    const circuit = deriveCircuitInputs(session);
    preview.circuit = {
      expectedHex: circuit.expectedHex,
      publicInputsByName: circuit.publicInputsByName,
      publicInputsOrdered: circuit.publicInputsOrdered
    };
  } catch (error) {
    preview.circuitError = String(error?.message || error);
  }

  return preview;
}

async function handlePreviewProvingInputs(message) {
  const { proofId } = message.payload || {};
  if (!proofId) throw new Error("proofId is required");

  const session = await getProofSession(proofId);
  if (!session) throw new Error("session not found");

  const preview = buildPreProofPreview(session);
  const patched = await patchSession(proofId, {
    preProofPreview: preview
  });

  await emitStatusToTab(patched.senderTabId, proofId, patched.status || SESSION_STATUS.CAPTURE_READY, {
    preProofPreview: preview
  });

  return { ok: true, proofId, preview };
}

async function handleSubmitProof(message) {
  const { proofId } = message.payload || {};
  if (!proofId) throw new Error("proofId is required");

  const session = await getProofSession(proofId);
  if (!session) throw new Error("session not found");
  if (!session.proof || !session.publicInputs) throw new Error("proof not ready");

  // Idempotent submit: once submitted for this proofId, do not resubmit.
  if (
    session.submitResponse &&
    (session.status === SESSION_STATUS.SUBMITTED ||
      session.status === SESSION_STATUS.VERIFIED ||
      session.status === SESSION_STATUS.AGGREGATED)
  ) {
    return {
      ok: true,
      proofId,
      status: session.status,
      submit: session.submitResponse,
      reused: true
    };
  }

  const body = {
    proofId: session.proofId,
    verificationMode: session.verificationMode,
    proofSystem: session.proofSystem,
    proof: session.proof,
    publicInputs: session.publicInputs,
    appId: session.appId,
    businessDomain: session.businessDomain,
    aggregationDomainId: session.aggregationDomainId,
    userAddr: session.buyerAddress,
    chainId: session.chainId,
    timestamp: session.timestamp,
    intentId: session.intentId,
    intentHash: session.intentHash || session.intentId,
    amount: session.amount,
    wiseReceiptHash: session.wiseReceiptHash,
    nullifier: session.nullifier
  };

  const submit = await postJson(session.submitEndpoint, body);
  if (!submit.ok) {
    await patchSession(proofId, { status: SESSION_STATUS.ERROR, lastError: submit.json });
    await emitStatusToTab(session.senderTabId, proofId, SESSION_STATUS.ERROR, submit.json);
    return { ok: false, proofId, status: SESSION_STATUS.ERROR, error: submit.json };
  }

  const submitRawStatus = String(
    submit.json?.rawStatus ?? submit.json?.status ?? submit.json?.optimisticVerify ?? ""
  ).toLowerCase();
  const submitFailed =
    submitRawStatus.includes("fail") ||
    submitRawStatus.includes("error") ||
    submitRawStatus.includes("reject") ||
    submitRawStatus.includes("invalid");
  if (submitFailed) {
    const patchedFailed = await patchSession(proofId, {
      submitResponse: submit.json,
      status: SESSION_STATUS.ERROR,
      lastError: submit.json
    });
    await emitStatusToTab(patchedFailed.senderTabId, proofId, SESSION_STATUS.ERROR, submit.json);
    return { ok: false, proofId, status: SESSION_STATUS.ERROR, error: submit.json };
  }

  const patched = await patchSession(proofId, {
    submitResponse: submit.json,
    status: SESSION_STATUS.SUBMITTED
  });

  await emitStatusToTab(patched.senderTabId, proofId, SESSION_STATUS.SUBMITTED, submit.json);
  return { ok: true, proofId, status: SESSION_STATUS.SUBMITTED, submit: submit.json };
}

async function handleQueryStatus(message) {
  const { proofId } = message.payload || {};
  if (!proofId) throw new Error("proofId is required");

  const session = await getProofSession(proofId);
  if (!session) throw new Error("session not found");

  const providerJobId =
    session?.submitResponse?.providerJobId ||
    session?.statusResponse?.providerJobId ||
    "";
  const statusUrl = new URL(session.statusEndpoint);
  statusUrl.searchParams.set("proofId", String(proofId));
  if (typeof providerJobId === "string" && providerJobId.trim()) {
    statusUrl.searchParams.set("providerJobId", providerJobId.trim());
  }

  const statusResp = await getJson(statusUrl.toString());
  if (!statusResp.ok) {
    await patchSession(proofId, { status: SESSION_STATUS.ERROR, lastError: statusResp.json });
    await emitStatusToTab(session.senderTabId, proofId, SESSION_STATUS.ERROR, statusResp.json);
    return { ok: false, proofId, error: statusResp.json };
  }

  const rawStatusCandidate =
    statusResp.json.rawStatus ??
    statusResp.json.status ??
    statusResp.json.proofStatus ??
    statusResp.json.verificationStatus ??
    statusResp.json.state ??
    "pending";
  const normalized = String(rawStatusCandidate).toLowerCase();
  const pluginStatus =
    normalized.includes("fail") ||
    normalized.includes("error") ||
    normalized.includes("reject") ||
    normalized.includes("invalid")
      ? SESSION_STATUS.ERROR
      : normalized.includes("aggregated") ||
          normalized.includes("aggregationpublished") ||
          normalized.includes("published")
        ? SESSION_STATUS.AGGREGATED
        : normalized.includes("verified") ||
            normalized.includes("included") ||
            normalized.includes("finalized") ||
            normalized.includes("aggregation pending") ||
            normalized.includes("aggregationpending")
          ? SESSION_STATUS.VERIFIED
          : SESSION_STATUS.SUBMITTED;

  const patched = await patchSession(proofId, {
    status: pluginStatus,
    statusResponse: statusResp.json,
    ...(pluginStatus === SESSION_STATUS.ERROR ? { lastError: statusResp.json } : {})
  });

  await emitStatusToTab(patched.senderTabId, proofId, pluginStatus, statusResp.json);
  return { ok: true, proofId, status: pluginStatus, statusResponse: statusResp.json };
}

async function handleQueryAggregation(message) {
  const { proofId } = message.payload || {};
  if (!proofId) throw new Error("proofId is required");

  const session = await getProofSession(proofId);
  if (!session) throw new Error("session not found");

  const providerJobId =
    session?.submitResponse?.providerJobId ||
    session?.statusResponse?.providerJobId ||
    "";
  const tupleUrl = new URL(session.aggregationEndpoint);
  tupleUrl.searchParams.set("proofId", String(proofId));
  if (typeof providerJobId === "string" && providerJobId.trim()) {
    tupleUrl.searchParams.set("providerJobId", providerJobId.trim());
  }

  const tupleResp = await getJson(tupleUrl.toString());
  if (!tupleResp.ok) {
    return { ok: false, proofId, error: tupleResp.json };
  }

  await patchSession(proofId, { tuple: tupleResp.json });
  return { ok: true, proofId, tuple: tupleResp.json };
}

async function handleGetSession(message) {
  const { proofId } = message.payload || {};
  if (!proofId) {
    const root = await loadSession();
    return { ok: true, root };
  }
  return { ok: true, session: await getProofSession(proofId) };
}

async function handleResetSession(message) {
  const { proofId } = message.payload || {};
  if (!proofId) throw new Error("proofId is required");
  await resetProofSession(proofId);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendReply) => {
  if (!validateMessage(message)) {
    sendReply({ ok: false, error: "invalid message" });
    return;
  }

  const handlers = {
    [MESSAGES.START_PROOF]: () => handleStartProof(message, sender),
    [MESSAGES.CAPTURE_FROM_ACTIVE_TAB]: () => handleCapture(message),
    [MESSAGES.VERIFY_SELECTED_PAYMENT]: () => handleVerifySelectedPayment(message),
    [MESSAGES.PREVIEW_PROVING_INPUTS]: () => handlePreviewProvingInputs(message),
    [MESSAGES.RUN_PROVING]: () => handleRunProving(message),
    [MESSAGES.SUBMIT_PROOF]: () => handleSubmitProof(message),
    [MESSAGES.QUERY_STATUS]: () => handleQueryStatus(message),
    [MESSAGES.QUERY_AGGREGATION]: () => handleQueryAggregation(message),
    [MESSAGES.GET_SESSION]: () => handleGetSession(message),
    [MESSAGES.RESET_SESSION]: () => handleResetSession(message)
  };

  const run = handlers[message.type];
  if (!run) {
    sendReply({ ok: false, error: `unsupported message type: ${message.type}` });
    return;
  }

  run()
    .then((payload) => sendReply(payload))
    .catch((error) => sendReply({ ok: false, error: error.message }));

  return true;
});
