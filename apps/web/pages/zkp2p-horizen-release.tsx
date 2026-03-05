import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BrowserProvider, Contract, formatUnits, isAddress, parseUnits } from "ethers";
import {
  canPromptReleaseWallet,
  reduceProofState,
  type ConsumeStage
} from "@/src/zk/zkp2p-horizen-release/state-machine";
import {
  FIELD_MODULUS,
  buildNullifier,
  buildStatement
} from "@/src/zk/zkp2p-horizen-release/statement";
import { ensureBrowserProverInstalled } from "@/src/zk/zkp2p-horizen-release/browser-prover";

type TradeMode = "buy" | "sell";
type DepositView = "deposits" | "closed";
type PluginAction = "capture" | "prove" | "submit" | "status" | "tuple";
type DepositStep = "amount" | "platforms" | "review";
type PoolStatus = "healthy" | "low liquidity" | "paused";

type SellerQuote = {
  id: string;
  recordId: string;
  sellerAddress: string;
  wiseTag: string;
  sellerLabel: string;
  receiveUsdc: number;
  hkdValue: number;
  spreadLabel: string;
  availableUsdc: number;
  fillable: boolean;
  shortfallUsdc: number;
  wiseQrDataUrl: string;
  wiseQrFileName: string;
  method: string;
  hasWiseSetup: boolean;
  best?: boolean;
};

type QrOrder = {
  quote: SellerQuote;
  sendAmountHkd: number;
  receiveUsdc: number;
  reservation: IntentReservation;
};

type PendingReserveOrder = Omit<QrOrder, "reservation">;

type IntentReservation = {
  intentId: `0x${string}`;
  intentHash: `0x${string}`;
  nullifierHash: `0x${string}`;
  proverSecret: string;
  statement: `0x${string}`;
  timestamp: number;
  chainId: number;
  businessDomain: string;
  appId: string;
  deadline: number;
  reservationTxHash: `0x${string}`;
};

type DepositRecord = {
  id: string;
  depositor: string;
  remaining: number;
  locked: number;
  taken: number;
  platforms: string[];
  currency: string;
  status: PoolStatus;
  poolState: DepositView;
  wiseTag: string;
  wiseQrDataUrl: string;
  wiseQrFileName: string;
  txHash: `0x${string}`;
  createdAt: string;
};

type SellerLiquidityRow = {
  sellerAddress: string;
  depositedUsdc: number;
  reservedUsdc: number;
  availableUsdc: number;
  eventDepositedUsdc: number;
  lastDepositTxHash: string;
  lastDepositBlock: number;
  lastDepositAt: string;
};

type SellerProfile = {
  sellerAddress: string;
  wiseTag: string;
  wiseQrDataUrl: string;
  wiseQrFileName: string;
  updatedAt: string;
};

const consumeSequence: ConsumeStage[] = [
  "aggregated_ready",
  "buyer_signing",
  "action_submitting",
  "action_done"
];

const defaultBuyerAddress = "0x000000000000000000000000000000000000b0b0";

const depositPoolAbi = [
  "function token() view returns (address)",
  "function availableBalance() view returns (uint256)",
  "function sellerDeposits(address) view returns (uint256)",
  "function sellerReserved(address) view returns (uint256)",
  "function deposit(uint256 amount)",
  "function createIntent(bytes32 intentId,address seller,uint256 amount,uint256 deadline,bytes32 nullifierHash,bytes32 intentHash)",
  "function releaseWithProof(bytes32 intentId,bytes32 nullifierHash,bytes32 proofIntentHash,uint256 domainId,uint256 aggregationId,bytes32 leaf,bytes32[] merklePath,uint256 leafCount,uint256 index)"
];

const erc20Abi = ["function approve(address spender,uint256 amount) returns (bool)"];
const sellerRecordsStorageKey = "zkp2p-seller-deposits-v2-onchain";
const releaseTxStorageKeyPrefix = "zkp2p-release-tx:";

const poolErrorMessages: Record<string, string> = {
  "0xa3929340": "SellerDepositTooLow：卖方链上可用额度不足（本地列表和链上状态不一致，或额度已被占用）",
  "0xa51deb3e": "InsufficientAvailableBalance：池子总可用余额不足",
  "0x0ac00304": "IntentAlreadyExists：该 intentId 已存在，请重试",
  "0x769d11e4": "InvalidDeadline：截止时间无效",
  "0xbab7ca35": "InvalidSeller：卖方地址无效"
};

function getConfiguredChainId(): bigint | null {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID;
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return BigInt(Math.trunc(parsed));
}

function getDepositPoolAddress(): string | null {
  return process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_DEPOSIT_POOL_ADDRESS ?? null;
}

function getIntentTtlSeconds(): number {
  const raw = process.env.NEXT_PUBLIC_INTENT_TTL_SECONDS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 60) return Math.trunc(parsed);
  return 30 * 60;
}

const KURIER_API_ID = "zkp2p";
// zkVerify domain-management doc: Horizen testnet domain id is 175.
const KURIER_AGGREGATION_DOMAIN_ID = "175";
const TUPLE_POLL_INTERVAL_MS = 5000;
const TUPLE_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function nonEmptyString(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return null;
}

function toFixed2(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function randomHex32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex}`;
}

function randomProofId(): string {
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
  return `proof-${Date.now()}-${rand}`;
}

function randomFieldSecret(): bigint {
  // Keep secret strictly inside Noir field and non-zero.
  // 31 bytes is always < BN254 scalar field modulus.
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let out = 0n;
  for (const byte of bytes) {
    out = out * 256n + BigInt(byte);
  }
  const normalized = out % FIELD_MODULUS;
  return normalized === 0n ? 1n : normalized;
}

function shortAddress(value: string): string {
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function resolvePoolErrorMessage(error: unknown): string | null {
  const message = (error as { message?: string })?.message;
  if (!message) return null;
  const explicitData = message.match(/data=\"(0x[0-9a-fA-F]{8})/);
  const selector = explicitData?.[1]?.toLowerCase();
  if (!selector) return null;
  return poolErrorMessages[selector] ?? `合约自定义错误: ${selector}`;
}

function extractActiveProofIdFromPluginError(errorPayload: unknown): string | null {
  const text = typeof errorPayload === "string" ? errorPayload : JSON.stringify(errorPayload);
  if (!text) return null;
  const match = text.match(/active proof session not finished:\s*([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function parseUintLike(raw: unknown): bigint | null {
  if (typeof raw === "bigint") return raw >= 0n ? raw : null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return BigInt(Math.trunc(raw));
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return null;
    if (/^0x[0-9a-fA-F]+$/.test(value)) {
      const parsed = BigInt(value);
      return parsed >= 0n ? parsed : null;
    }
    if (/^[0-9]+$/.test(value)) return BigInt(value);
  }
  return null;
}

function normalizeBytes32(raw: unknown): `0x${string}` | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

function mapPluginStatusToProofStatus(rawStatus: unknown): "pending" | "verified" | "aggregated" {
  const normalized = String(rawStatus ?? "pending").toLowerCase();
  if (normalized.includes("aggregated")) return "aggregated";
  if (normalized.includes("verified")) return "verified";
  return "pending";
}

function normalizeTuplePayload(tuplePayload: unknown, fallbackProofId: string) {
  if (!tuplePayload || typeof tuplePayload !== "object") return null;
  const tuple = tuplePayload as Record<string, unknown>;
  return {
    proofId: String(tuple.proofId ?? fallbackProofId),
    aggregationDomainId: String(tuple.aggregationDomainId ?? ""),
    aggregationId: String(tuple.aggregationId ?? ""),
    leafCount: String(tuple.leafCount ?? ""),
    index: String(tuple.index ?? ""),
    leaf: String(tuple.leaf ?? ""),
    merklePath: Array.isArray(tuple.merklePath) ? tuple.merklePath.map((x) => String(x)) : [],
    intentHash: String(tuple.intentHash ?? ""),
    nullifier: String(tuple.nullifier ?? "")
  };
}

export default function Zkp2pHorizenReleasePage() {
  const [pluginLogs, setPluginLogs] = useState<string[]>([]);
  const [pluginBusy, setPluginBusy] = useState(false);

  const [tradeMode, setTradeMode] = useState<TradeMode>("buy");
  const [depositView, setDepositView] = useState<DepositView>("deposits");

  const [sendAmount, setSendAmount] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState("");

  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showSellerQrModal, setShowSellerQrModal] = useState(false);
  const [depositStep, setDepositStep] = useState<DepositStep>("amount");
  const [depositAmount, setDepositAmount] = useState("1000");
  const [telegramUsername, setTelegramUsername] = useState("");
  const [wiseTag, setWiseTag] = useState("jianjinl");
  const [wiseQrDataUrl, setWiseQrDataUrl] = useState("");
  const [wiseQrFileName, setWiseQrFileName] = useState("");
  const [depositTxHash, setDepositTxHash] = useState<`0x${string}` | null>(null);

  const [depositRecords, setDepositRecords] = useState<DepositRecord[]>([]);
  const [chainSellerRows, setChainSellerRows] = useState<SellerLiquidityRow[]>([]);
  const [sellerProfilesByAddress, setSellerProfilesByAddress] = useState<Record<string, SellerProfile>>({});
  const [pendingQrOrder, setPendingQrOrder] = useState<QrOrder | null>(null);
  const [recordsHydrated, setRecordsHydrated] = useState(false);
  const [lastReservedIntentId, setLastReservedIntentId] = useState<`0x${string}` | null>(null);
  const [latestTuple, setLatestTuple] = useState<{
    proofId: string;
    aggregationDomainId: string;
    aggregationId: string;
    leafCount: string;
    index: string;
    leaf: string;
    merklePath: string[];
    intentHash: string;
    nullifier: string;
  } | null>(null);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseTxHash, setReleaseTxHash] = useState<string | null>(null);
  const autoTupleProofRef = useRef<string | null>(null);
  const tuplePollStartRef = useRef<{ proofId: string; startedAt: number } | null>(null);
  const autoReleaseProofRef = useRef<string | null>(null);
  const lastPolledPluginStatusRef = useRef<string>("");

  const [state, dispatch] = useReducer(reduceProofState, {
    activeProofId: null,
    proofStatus: "pending",
    consumeStage: "aggregated_ready",
    rawStatus: "pending",
    walletConnected: false,
    buyerReady: false
  });

  const sendAmountNumber = useMemo(() => {
    const parsed = Number(sendAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return parsed;
  }, [sendAmount]);

  const depositAmountNumber = useMemo(() => {
    const parsed = Number(depositAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return parsed;
  }, [depositAmount]);

  const sellerMetaByAddress = useMemo(() => {
    const map = new Map<string, DepositRecord>();
    for (const record of depositRecords) {
      const key = record.depositor.toLowerCase();
      const existing = map.get(key);
      if (!existing) {
        map.set(key, record);
        continue;
      }

      const existingHasWiseSetup =
        existing.wiseTag.trim().length > 0 && existing.wiseQrDataUrl.trim().length > 0;
      const nextHasWiseSetup =
        record.wiseTag.trim().length > 0 && record.wiseQrDataUrl.trim().length > 0;

      // Keep first (newest) by default, but if it lacks Wise setup and an older entry has it, upgrade metadata.
      if (!existingHasWiseSetup && nextHasWiseSetup) {
        map.set(key, record);
      }
    }
    return map;
  }, [depositRecords]);

  const sellerQuotes = useMemo(() => {
    if (sendAmountNumber <= 0) return [] as SellerQuote[];

    const quotes = chainSellerRows
      .map((row) => {
        const record = sellerMetaByAddress.get(row.sellerAddress.toLowerCase());
        const profile = sellerProfilesByAddress[row.sellerAddress.toLowerCase()];
        if (row.availableUsdc <= 0) return null;

        const wiseTag = (record?.wiseTag ?? profile?.wiseTag ?? "").trim().replace(/^@+/, "");
        const wiseQrDataUrl = (record?.wiseQrDataUrl ?? profile?.wiseQrDataUrl ?? "").trim();
        const wiseQrFileName = (record?.wiseQrFileName ?? profile?.wiseQrFileName ?? "").trim();
        const hasWiseSetup = wiseTag.length > 0 && wiseQrDataUrl.length > 0;

        const rate = 1;
        const receiveUsdc = Number((sendAmountNumber * rate).toFixed(2));
        const fillable = receiveUsdc > 0 && row.availableUsdc >= receiveUsdc && hasWiseSetup;
        const shortfallUsdc = Math.max(0, Number((receiveUsdc - row.availableUsdc).toFixed(2)));
        const sellerLabel = wiseTag ? `@${wiseTag}` : shortAddress(row.sellerAddress);

        return {
          id: `quote-${record?.id ?? row.sellerAddress.toLowerCase()}`,
          recordId: record?.id ?? row.sellerAddress.toLowerCase(),
          sellerAddress: row.sellerAddress,
          wiseTag,
          sellerLabel,
          receiveUsdc,
          hkdValue: sendAmountNumber,
          spreadLabel: "1.0000 HKD / USDC",
          availableUsdc: row.availableUsdc,
          fillable,
          shortfallUsdc,
          wiseQrDataUrl,
          wiseQrFileName,
          method: "Wise",
          hasWiseSetup
        } satisfies SellerQuote;
      })
      .filter((quote): quote is SellerQuote => quote !== null)
      .sort((a, b) => {
        if (a.fillable !== b.fillable) return a.fillable ? -1 : 1;
        if (b.receiveUsdc !== a.receiveUsdc) return b.receiveUsdc - a.receiveUsdc;
        return b.availableUsdc - a.availableUsdc;
      });

    return quotes.map((quote, index) => ({
      ...quote,
      best: index === 0 && quote.fillable
    }));
  }, [chainSellerRows, sendAmountNumber, sellerMetaByAddress, sellerProfilesByAddress]);

  const selectedQuote = useMemo(
    () => sellerQuotes.find((quote) => quote.id === selectedQuoteId) ?? sellerQuotes[0] ?? null,
    [sellerQuotes, selectedQuoteId]
  );

  const receiveUsdc = useMemo(() => {
    if (!selectedQuote) return 0;
    return selectedQuote.receiveUsdc;
  }, [selectedQuote]);

  const showQuotes = tradeMode === "buy" && sendAmountNumber > 0;

  const canStartOrder = Boolean(
    walletAddress && sendAmountNumber > 0 && selectedQuote && selectedQuote.fillable && !pluginBusy
  );

  const canRelease = useMemo(
    () =>
      canPromptReleaseWallet({
        activeProofId: state.activeProofId,
        proofStatus: state.proofStatus,
        consumeStage: state.consumeStage,
        rawStatus: state.rawStatus,
        walletConnected: state.walletConnected,
        buyerReady: state.buyerReady
      }),
    [state]
  );

  const mergedDepositRecords = useMemo(() => {
    const chainRows = chainSellerRows.map((row) => {
      const meta = sellerMetaByAddress.get(row.sellerAddress.toLowerCase());
      const profile = sellerProfilesByAddress[row.sellerAddress.toLowerCase()];
      const taken = Math.max(0, row.eventDepositedUsdc - row.depositedUsdc);
      const poolState = meta?.poolState ?? "deposits";
      const status: PoolStatus =
        poolState === "closed" ? "paused" : row.availableUsdc < 300 ? "low liquidity" : "healthy";
      const wiseTag = (meta?.wiseTag ?? profile?.wiseTag ?? "").trim().replace(/^@+/, "");
      const wiseQrDataUrl = (meta?.wiseQrDataUrl ?? profile?.wiseQrDataUrl ?? "").trim();
      const wiseQrFileName = (meta?.wiseQrFileName ?? profile?.wiseQrFileName ?? "").trim();
      const hasWiseSetup = wiseTag.length > 0 && wiseQrDataUrl.length > 0;

      return {
        id: meta?.id ?? `CHAIN-${row.sellerAddress.slice(2, 8)}`,
        depositor: row.sellerAddress,
        remaining: row.availableUsdc,
        locked: row.reservedUsdc,
        taken,
        platforms: hasWiseSetup ? ["Wise"] : ["N/A"],
        currency: "USDC",
        status,
        poolState,
        wiseTag,
        wiseQrDataUrl,
        wiseQrFileName: wiseQrFileName || "wise-qr",
        txHash: row.lastDepositTxHash as `0x${string}`,
        createdAt: meta?.createdAt ?? row.lastDepositAt
      } satisfies DepositRecord;
    });

    const chainAddressSet = new Set(chainRows.map((record) => record.depositor.toLowerCase()));
    const pendingLocalRows = depositRecords
      .filter((record) => !chainAddressSet.has(record.depositor.toLowerCase()))
      .map((record) => ({
        ...record,
        status: record.poolState === "closed" ? "paused" : record.status
      }));

    return [...chainRows, ...pendingLocalRows];
  }, [chainSellerRows, depositRecords, sellerMetaByAddress, sellerProfilesByAddress]);

  const visibleRecords = useMemo(
    () => mergedDepositRecords.filter((record) => record.poolState === depositView),
    [depositView, mergedDepositRecords]
  );

  const appendPluginLog = useCallback((line: string) => {
    setPluginLogs((current) => [`${new Date().toLocaleTimeString()} ${line}`, ...current].slice(0, 14));
  }, []);
  const latestLog = pluginLogs[0] ?? "";

  const applyProofStatus = useCallback(
    (proofId: string, rawStatus: unknown) => {
      const status = mapPluginStatusToProofStatus(rawStatus);
      dispatch({
        type: "proof-status",
        proofId,
        status,
        rawStatus: String(rawStatus ?? "pending")
      });
      if (status === "aggregated") {
        dispatch({ type: "consume-stage", stage: "aggregated_ready" });
      }
    },
    [dispatch]
  );

  const loadChainSellerRows = useCallback(async () => {
    try {
      const response = await fetch("/api/sellers?limit=500");
      const payload = (await response.json()) as {
        rows?: SellerLiquidityRow[];
        profiles?: Record<string, SellerProfile>;
        detail?: string;
      };

      if (!response.ok) {
        appendPluginLog(`load sellers failed: ${payload.detail ?? "unknown error"}`);
        return;
      }

      setChainSellerRows(Array.isArray(payload.rows) ? payload.rows : []);
      setSellerProfilesByAddress(payload.profiles ?? {});
    } catch (error) {
      appendPluginLog(`load sellers error: ${(error as Error).message}`);
    }
  }, [appendPluginLog]);

  const upsertSellerLiquidityRow = useCallback((row: SellerLiquidityRow) => {
    setChainSellerRows((current) => {
      const next = [...current];
      const index = next.findIndex(
        (entry) => entry.sellerAddress.toLowerCase() === row.sellerAddress.toLowerCase()
      );

      if (index >= 0) next[index] = row;
      else next.push(row);

      next.sort((a, b) => {
        if (b.availableUsdc !== a.availableUsdc) return b.availableUsdc - a.availableUsdc;
        return b.lastDepositBlock - a.lastDepositBlock;
      });
      return next;
    });
  }, []);

  const withPlugin = async <T,>(
    fn: (plugin: NonNullable<typeof window.zkp2pProofPlugin>) => Promise<T>
  ): Promise<T | null> => {
    const plugin = window.zkp2pProofPlugin;
    if (!plugin) {
      appendPluginLog("plugin 未注入，请先加载扩展并刷新页面");
      return null;
    }

    try {
      setPluginBusy(true);
      return await fn(plugin);
    } catch (error) {
      appendPluginLog(`plugin error: ${(error as Error).message}`);
      return null;
    } finally {
      setPluginBusy(false);
    }
  };

  const connectWallet = async () => {
    try {
      const ethereum = (window as unknown as {
        ethereum?: {
          request: (args: { method: string }) => Promise<string[]>;
        };
      }).ethereum;

      if (!ethereum) {
        appendPluginLog("未检测到钱包扩展（MetaMask）");
        return;
      }

      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      const account = accounts?.[0];
      if (!account) {
        appendPluginLog("钱包返回空账户");
        return;
      }

      setWalletAddress(account);
      dispatch({ type: "wallet", connected: true });
      appendPluginLog(`wallet connected: ${account}`);
    } catch (error) {
      appendPluginLog(`wallet error: ${(error as Error).message}`);
    }
  };

  useEffect(() => {
    const ethereum = (window as unknown as {
      ethereum?: {
        request: (args: { method: string }) => Promise<string[]>;
        on?: (event: string, listener: (...args: unknown[]) => void) => void;
        removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
      };
    }).ethereum;
    if (!ethereum?.request) return;

    let cancelled = false;

    const syncWallet = async () => {
      try {
        const accounts = await ethereum.request({ method: "eth_accounts" });
        const account = accounts?.[0] ?? null;
        if (cancelled) return;
        setWalletAddress(account);
        dispatch({ type: "wallet", connected: Boolean(account) });
      } catch {
        // no-op
      }
    };

    const handleAccountsChanged = (accounts: unknown) => {
      const account = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
      setWalletAddress(account);
      dispatch({ type: "wallet", connected: Boolean(account) });
      if (account) {
        appendPluginLog(`wallet changed: ${account}`);
      } else {
        appendPluginLog("wallet disconnected");
      }
    };

    void syncWallet();
    ethereum.on?.("accountsChanged", handleAccountsChanged);
    ethereum.on?.("chainChanged", syncWallet);

    return () => {
      cancelled = true;
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", syncWallet);
    };
  }, [appendPluginLog, dispatch]);

  useEffect(() => {
    let cancelled = false;
    ensureBrowserProverInstalled()
      .then(() => {
        if (!cancelled) {
          appendPluginLog("UltraHonk browser prover runtime ready");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          appendPluginLog(`UltraHonk runtime init failed: ${(error as Error).message}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appendPluginLog]);

  const startPluginProofWithAmount = async (
    amountUsdc: number,
    source: "buy-order" | "sell-deposit",
    quote?: SellerQuote,
    reservation?: IntentReservation
  ): Promise<boolean> => {
    if (!walletAddress) {
      appendPluginLog("请先连接钱包，再启动 proof 插件");
      return false;
    }

    if (amountUsdc <= 0) {
      appendPluginLog("金额无效，无法启动插件");
      return false;
    }

    if (!process.env.NEXT_PUBLIC_TLSN_WISE_PLUGIN_URL) {
      appendPluginLog("未配置 NEXT_PUBLIC_TLSN_WISE_PLUGIN_URL：将先启动插件；到 Capture 时会提示 TLSN 配置缺失");
    }

    const proofId = randomProofId();
    dispatch({ type: "new-proof", proofId });
    setReleaseTxHash(null);

    const fallbackBusinessDomain = nonEmptyString(process.env.NEXT_PUBLIC_BUSINESS_DOMAIN, "zkp2p-horizen");
    const fallbackAppId = nonEmptyString(KURIER_API_ID, "zkp2p");
    const fallbackChainId = toPositiveInt(getConfiguredChainId()?.toString()) ?? 0;
    const fallbackTimestamp = Math.floor(Date.now() / 1000);
    const reservationChainId = toPositiveInt(reservation?.chainId);
    const reservationTimestamp = toPositiveInt(reservation?.timestamp);

    const intentId = reservation?.intentId ?? randomHex32();
    const intentHash = reservation?.intentHash ?? intentId;
    const proverSecret = reservation?.proverSecret ?? randomFieldSecret().toString();
    const nullifier =
      reservation?.nullifierHash ??
      buildNullifier({
        secret: BigInt(proverSecret),
        intentId
      });

    const payload = {
      proofId,
      source,
      intentId,
      intentHash,
      buyerAddress: walletAddress ?? defaultBuyerAddress,
      amount: String(Math.round(amountUsdc * 1_000_000)),
      businessDomain: nonEmptyString(reservation?.businessDomain, fallbackBusinessDomain),
      aggregationDomainId: KURIER_AGGREGATION_DOMAIN_ID,
      appId: nonEmptyString(reservation?.appId, fallbackAppId),
      chainId: reservationChainId ?? fallbackChainId,
      timestamp: reservationTimestamp ?? fallbackTimestamp,
      nullifier,
      proverSecret,
      verificationMode: "aggregation-kurier",
      proofSystem: "ultrahonk",
      submitEndpoint: `${location.origin}/api/submit-proof`,
      statusEndpoint: `${location.origin}/api/proof-status`,
      aggregationEndpoint: `${location.origin}/api/proof-aggregation`,
      wiseAttestationEndpoint:
        process.env.NEXT_PUBLIC_TLSN_VERIFIER_URL ?? `${location.origin}/api/verify-wise-attestation`,
      tlsnPluginUrl: process.env.NEXT_PUBLIC_TLSN_WISE_PLUGIN_URL ?? "",
      wiseUrl: "https://wise.com/all-transactions",
      statement: reservation?.statement ?? null,
      deadline: reservation?.deadline ?? null,
      reservationTxHash: reservation?.reservationTxHash ?? null,
      sellerAddress: quote?.sellerAddress ?? null,
      sellerWiseTag: quote?.wiseTag ?? null,
      sellerDepositId: quote?.recordId ?? null,
      sellerWiseQrImage: quote?.wiseQrDataUrl ?? null,
      quotePayload: null,
      publicInputs: [],
      forceStart: true
    };

    const tryStartProof = () =>
      withPlugin(async (plugin) => {
        const result = await plugin.startProof(payload);
        return result as { ok?: boolean; error?: unknown };
      });

    let result = await tryStartProof();

    if (result && typeof result === "object" && "ok" in result && result.ok === false) {
      const blockedProofId = extractActiveProofIdFromPluginError(result.error);
      if (blockedProofId) {
        appendPluginLog(`检测到旧会话阻塞，自动清理: ${blockedProofId}`);
        const resetResp = await withPlugin((plugin) => plugin.resetSession(blockedProofId));
        if (resetResp && (resetResp as { ok?: boolean }).ok !== false) {
          appendPluginLog(`旧会话已清理，重试 startProof...`);
          result = await tryStartProof();
        } else {
          appendPluginLog(`resetSession 失败: ${JSON.stringify(resetResp)}`);
        }
      }
    }

    if (!result) return false;
    if (typeof result === "object" && "ok" in result && result.ok === false) {
      appendPluginLog(`startProof failed: ${JSON.stringify(result.error ?? result)}`);
      return false;
    }

    appendPluginLog(`startProof: ${JSON.stringify(result)}`);
    return true;
  };

  const reserveIntentOnChain = async (order: PendingReserveOrder): Promise<IntentReservation | null> => {
    const ethereum = (window as unknown as {
      ethereum?: {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
    }).ethereum;

    if (!ethereum) {
      appendPluginLog("未检测到钱包扩展（MetaMask）");
      return null;
    }

    const contractAddress = getDepositPoolAddress();
    if (!contractAddress || !isAddress(contractAddress)) {
      appendPluginLog("NEXT_PUBLIC_CONTRACT_ADDRESS / NEXT_PUBLIC_DEPOSIT_POOL_ADDRESS 未配置或地址不合法");
      return null;
    }

    const provider = new BrowserProvider(ethereum);
    const network = await provider.getNetwork();
    const configuredChainId = getConfiguredChainId();
    if (configuredChainId !== null && network.chainId !== configuredChainId) {
      appendPluginLog(
        `请切换网络到 chainId=${configuredChainId.toString()}，当前=${network.chainId.toString()}`
      );
      return null;
    }

    const signer = await provider.getSigner();
    const buyerAddress = await signer.getAddress();
    const amount = parseUnits(order.receiveUsdc.toFixed(2), 6);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const intentTtlSec = BigInt(getIntentTtlSeconds());
    const deadline = nowSec + intentTtlSec;
    const intentId = randomHex32();
    const intentHash = intentId;
    const proverSecret = randomFieldSecret();
    const nullifierHash = buildNullifier({ secret: proverSecret, intentId });
    const businessDomain = nonEmptyString(process.env.NEXT_PUBLIC_BUSINESS_DOMAIN, "zkp2p-horizen");
    const appId = nonEmptyString(KURIER_API_ID, "zkp2p");
    const statement = buildStatement({
      intentId,
      buyerAddress: buyerAddress as `0x${string}`,
      amount,
      chainId: network.chainId,
      timestamp: nowSec,
      businessDomain,
      appId
    });

    const contract = new Contract(contractAddress, depositPoolAbi, signer);
    const sellerAddress = order.quote.sellerAddress;
    const [poolAvailableRaw, sellerDepositRaw, sellerReservedRaw] = await Promise.all([
      contract.availableBalance() as Promise<bigint>,
      contract.sellerDeposits(sellerAddress) as Promise<bigint>,
      contract.sellerReserved(sellerAddress) as Promise<bigint>
    ]);
    const sellerFree = sellerDepositRaw - sellerReservedRaw;
    appendPluginLog(
      `[reserve-check] contract=${contractAddress} chainId=${network.chainId.toString()} seller=${shortAddress(
        sellerAddress
      )} deposit=${formatUnits(sellerDepositRaw, 6)} reserved=${formatUnits(
        sellerReservedRaw,
        6
      )} free=${formatUnits(sellerFree, 6)} need=${formatUnits(amount, 6)} pool=${formatUnits(poolAvailableRaw, 6)}`
    );
    appendPluginLog(`intent deadline in ${intentTtlSec.toString()}s`);

    if (poolAvailableRaw < amount) {
      appendPluginLog(
        `链上可用余额不足: pool=${formatUnits(poolAvailableRaw, 6)} USDC, need=${formatUnits(amount, 6)} USDC`
      );
      return null;
    }
    if (sellerFree < amount) {
      appendPluginLog(
        `卖方链上可用额度不足: seller=${shortAddress(sellerAddress)}, free=${formatUnits(
          sellerFree,
          6
        )} USDC, need=${formatUnits(amount, 6)} USDC。请刷新报价或让卖方补充质押。`
      );
      return null;
    }

    appendPluginLog(`createIntent submitting for ${order.quote.sellerLabel}...`);
    let tx;
    try {
      tx = await contract["createIntent(bytes32,address,uint256,uint256,bytes32,bytes32)"](
        intentId,
        order.quote.sellerAddress,
        amount,
        deadline,
        nullifierHash,
        intentHash
      );
    } catch (error) {
      const knownMessage = resolvePoolErrorMessage(error);
      if (knownMessage) {
        appendPluginLog(`createIntent failed: ${knownMessage}`);
        return null;
      }
      throw error;
    }
    appendPluginLog(`createIntent tx: ${tx.hash}`);
    const receipt = await tx.wait();
    if (!receipt || Number(receipt.status) !== 1) {
      appendPluginLog("createIntent reverted");
      return null;
    }

    appendPluginLog(`createIntent confirmed: ${tx.hash}`);
    return {
      intentId,
      intentHash,
      nullifierHash,
      proverSecret: proverSecret.toString(),
      statement,
      timestamp: Number(nowSec),
      chainId: Number(network.chainId),
      businessDomain,
      appId,
      deadline: Number(deadline),
      reservationTxHash: tx.hash as `0x${string}`
    };
  };

  const runPluginAction = useCallback(async (action: PluginAction) => {
    const activeProofId = state.activeProofId;
    if (!activeProofId) {
      appendPluginLog("activeProofId 为空，先启动 proof 插件");
      return;
    }

    const result = await withPlugin(async (plugin) => {
      let result: unknown;
      if (action === "capture") result = await plugin.captureFromActiveTab(activeProofId);
      if (action === "prove") result = await plugin.runProving(activeProofId);
      if (action === "submit") result = await plugin.submitProof(activeProofId);
      if (action === "status") {
        result = await plugin.queryStatus(activeProofId);
        if ((result as { ok?: boolean })?.ok) {
          const statusPayload = result as {
            status?: unknown;
            statusResponse?: { status?: unknown; rawStatus?: unknown };
          };
          const rawStatus = statusPayload.statusResponse?.rawStatus ?? statusPayload.statusResponse?.status ?? statusPayload.status;
          applyProofStatus(activeProofId, rawStatus ?? "pending");
        }
      }
      if (action === "tuple") {
        result = await plugin.queryAggregation(activeProofId);
        if ((result as { ok?: boolean })?.ok) {
          const tuple = normalizeTuplePayload((result as { tuple?: unknown }).tuple, activeProofId);
          if (tuple) {
            setLatestTuple(tuple);
          }
          dispatch({ type: "buyer-ready", ok: true });
          appendPluginLog("tuple 已取回，可进入 buyer 签名阶段");
        }
      }

      return result;
    });
    if (result !== null) {
      appendPluginLog(`${action}: ${JSON.stringify(result)}`);
    }
  }, [appendPluginLog, applyProofStatus, dispatch, state.activeProofId, withPlugin]);

  const releaseWithAggregationProof = useCallback(async () => {
    if (releaseBusy) return;
    const proofId = state.activeProofId;
    if (!proofId) {
      appendPluginLog("activeProofId 为空，无法 release");
      return;
    }

    setReleaseBusy(true);
    try {
      let tuple = latestTuple;
      if (!tuple || tuple.proofId !== proofId) {
        const tupleResp = await withPlugin((plugin) => plugin.queryAggregation(proofId));
        if (!tupleResp || (tupleResp as { ok?: boolean }).ok === false) {
          appendPluginLog(`tuple 获取失败: ${JSON.stringify(tupleResp)}`);
          return;
        }

        const normalizedTuple = normalizeTuplePayload((tupleResp as { tuple?: unknown }).tuple, proofId);
        if (!normalizedTuple) {
          appendPluginLog("tuple payload 缺失，无法 release");
          return;
        }
        tuple = normalizedTuple;
        setLatestTuple(tuple);
        dispatch({ type: "buyer-ready", ok: true });
      }

      const sessionResp = await withPlugin((plugin) => plugin.getSession(proofId));
      const session = (sessionResp as { session?: Record<string, unknown> })?.session;
      if (!session) {
        appendPluginLog("插件会话为空，无法 release");
        return;
      }

      const intentId = normalizeBytes32(session.intentId);
      const nullifier = normalizeBytes32(session.nullifier);
      const proofIntentHash = normalizeBytes32(session.intentHash ?? session.intentId);
      const leaf = normalizeBytes32(tuple.leaf);
      if (!intentId || !nullifier || !proofIntentHash || !leaf) {
        appendPluginLog("release 参数不完整（intentId/nullifier/proofIntentHash/leaf）");
        return;
      }

      const tupleIntentHash = normalizeBytes32(tuple.intentHash);
      if (tupleIntentHash && tupleIntentHash !== proofIntentHash) {
        appendPluginLog(`tuple intentHash 与 proofIntentHash 不一致，拒绝 release: ${tupleIntentHash} != ${proofIntentHash}`);
        return;
      }
      const tupleNullifier = normalizeBytes32(tuple.nullifier);
      if (tupleNullifier && tupleNullifier !== nullifier) {
        appendPluginLog(`tuple nullifier 与 proof nullifier 不一致，拒绝 release: ${tupleNullifier} != ${nullifier}`);
        return;
      }
      const reservation = pendingQrOrder?.reservation;
      if (reservation) {
        if (reservation.intentHash.toLowerCase() !== proofIntentHash) {
          appendPluginLog(
            `reservation.intentHash 与 proofIntentHash 不一致，拒绝 release: ${reservation.intentHash} != ${proofIntentHash}`
          );
          return;
        }
        if (reservation.nullifierHash.toLowerCase() !== nullifier) {
          appendPluginLog(
            `reservation.nullifierHash 与 proof nullifier 不一致，拒绝 release: ${reservation.nullifierHash} != ${nullifier}`
          );
          return;
        }
      }

      const aggregationId = parseUintLike(tuple.aggregationId);
      const leafCount = parseUintLike(tuple.leafCount);
      const index = parseUintLike(tuple.index);
      const domainId =
        parseUintLike(tuple.aggregationDomainId) ??
        parseUintLike(KURIER_AGGREGATION_DOMAIN_ID) ??
        parseUintLike(process.env.NEXT_PUBLIC_AGGREGATION_DOMAIN_ID_ONCHAIN) ??
        parseUintLike(process.env.NEXT_PUBLIC_AGGREGATION_DOMAIN_NUMERIC_ID);
      if (!aggregationId || !leafCount || !domainId || index === null) {
        appendPluginLog("tuple 数值字段缺失（domainId/aggregationId/leafCount/index）");
        return;
      }

      const merklePath: `0x${string}`[] = [];
      for (const entry of tuple.merklePath) {
        const node = normalizeBytes32(entry);
        if (!node) {
          appendPluginLog(`merklePath 节点不是 bytes32: ${entry}`);
          return;
        }
        merklePath.push(node);
      }
      if (leafCount > 1n && merklePath.length === 0) {
        appendPluginLog("leafCount > 1 时 merklePath 不能为空，无法 release");
        return;
      }

      const ethereum = (window as unknown as {
        ethereum?: {
          request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
        };
      }).ethereum;
      if (!ethereum) {
        appendPluginLog("未检测到钱包扩展（MetaMask）");
        return;
      }

      const contractAddress = getDepositPoolAddress();
      if (!contractAddress || !isAddress(contractAddress)) {
        appendPluginLog("NEXT_PUBLIC_CONTRACT_ADDRESS / NEXT_PUBLIC_DEPOSIT_POOL_ADDRESS 未配置或地址不合法");
        return;
      }

      dispatch({ type: "consume-stage", stage: "buyer_signing" });
      const provider = new BrowserProvider(ethereum);
      const network = await provider.getNetwork();
      const configuredChainId = getConfiguredChainId();
      if (configuredChainId !== null && network.chainId !== configuredChainId) {
        appendPluginLog(
          `请切换网络到 chainId=${configuredChainId.toString()}，当前=${network.chainId.toString()}`
        );
        return;
      }

      const signer = await provider.getSigner();
      const contract = new Contract(contractAddress, depositPoolAbi, signer);
      dispatch({ type: "consume-stage", stage: "action_submitting" });
      appendPluginLog("releaseWithProof 提交中...");
      const tx = await contract.releaseWithProof(
        intentId,
        nullifier,
        proofIntentHash,
        domainId,
        aggregationId,
        leaf,
        merklePath,
        leafCount,
        index
      );
      appendPluginLog(`release tx: ${tx.hash}`);
      const receipt = await tx.wait();
      if (!receipt || Number(receipt.status) !== 1) {
        appendPluginLog("releaseWithProof reverted");
        dispatch({ type: "consume-stage", stage: "buyer_signing" });
        return;
      }

      setReleaseTxHash(tx.hash as string);
      try {
        window.localStorage.setItem(`${releaseTxStorageKeyPrefix}${proofId}`, tx.hash as string);
      } catch {
        // ignore localStorage write failure
      }
      dispatch({ type: "consume-stage", stage: "action_done" });
      appendPluginLog(`release confirmed: ${tx.hash}`);
    } catch (error) {
      dispatch({ type: "consume-stage", stage: "buyer_signing" });
      appendPluginLog(`release error: ${(error as Error).message}`);
    } finally {
      setReleaseBusy(false);
    }
  }, [
    appendPluginLog,
    dispatch,
    latestTuple,
    pendingQrOrder,
    releaseBusy,
    state.activeProofId,
    withPlugin
  ]);

  const openDepositModal = () => {
    setShowDepositModal(true);
    setDepositStep("amount");
    setDepositAmount("1000");
    setTelegramUsername("");
    setWiseTag("jianjinl");
    setWiseQrDataUrl("");
    setWiseQrFileName("");
    setDepositTxHash(null);
  };

  const openSellerQrModal = async () => {
    if (!walletAddress) {
      appendPluginLog("请先连接钱包，再发起买方订单");
      return;
    }
    if (!selectedQuote) {
      appendPluginLog("当前没有可用卖方，请先让卖方完成 Deposit、填写 Wise 并上传二维码");
      return;
    }
    if (!selectedQuote.fillable) {
      appendPluginLog(`该卖方余额不足，缺口 ${toFixed2(selectedQuote.shortfallUsdc)} USDC`);
      return;
    }
    if (!selectedQuote.wiseQrDataUrl) {
      appendPluginLog("卖方未上传可扫码的 Wise 二维码，请更换卖方");
      return;
    }
    const order = {
      quote: selectedQuote,
      sendAmountHkd: sendAmountNumber,
      receiveUsdc: selectedQuote.receiveUsdc
    };

    let reservation: IntentReservation | null = null;
    try {
      reservation = await reserveIntentOnChain(order);
    } catch (error) {
      appendPluginLog(`createIntent error: ${(error as Error).message}`);
      return;
    }
    if (!reservation) return;

    appendPluginLog(`buyer reserved ${toFixed2(order.receiveUsdc)} USDC from ${order.quote.sellerLabel}`);
    void loadChainSellerRows();
    setLastReservedIntentId(reservation.intentId);
    setPendingQrOrder({
      ...order,
      reservation
    });
    setShowSellerQrModal(true);
  };

  const closeSellerQrModal = () => {
    setShowSellerQrModal(false);
    setPendingQrOrder(null);
  };

  const launchBuyerOrderAfterQr = async () => {
    if (!pendingQrOrder) {
      appendPluginLog("未找到待支付订单，请重新选择卖方");
      return;
    }
    const quote = pendingQrOrder.quote;
    const amount = pendingQrOrder.receiveUsdc;
    const reservation = pendingQrOrder.reservation;
    closeSellerQrModal();
    const started = await startPluginProofWithAmount(amount, "buy-order", quote, reservation);
    if (started) {
      appendPluginLog("插件已启动并由插件打开 Wise 页；支付后回到本页点 Capture");
    }
  };

  const submitDepositAmountStep = async () => {
    if (!walletAddress) {
      appendPluginLog("请先连接钱包，再执行卖方 Deposit");
      return;
    }

    if (depositAmountNumber <= 0) {
      appendPluginLog("Deposit amount 必须大于 0");
      return;
    }

    const ethereum = (window as unknown as {
      ethereum?: {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
    }).ethereum;

    if (!ethereum) {
      appendPluginLog("未检测到钱包扩展（MetaMask）");
      return;
    }

    const contractAddress = getDepositPoolAddress();
    if (!contractAddress || !isAddress(contractAddress)) {
      appendPluginLog("NEXT_PUBLIC_CONTRACT_ADDRESS / NEXT_PUBLIC_DEPOSIT_POOL_ADDRESS 未配置或地址不合法");
      return;
    }

    try {
      const provider = new BrowserProvider(ethereum);
      const network = await provider.getNetwork();
      const configuredChainId = getConfiguredChainId();
      if (configuredChainId !== null && network.chainId !== configuredChainId) {
        appendPluginLog(
          `请切换网络到 chainId=${configuredChainId.toString()}，当前=${network.chainId.toString()}`
        );
        return;
      }

      const signer = await provider.getSigner();
      const amount = parseUnits(depositAmountNumber.toFixed(2), 6);
      const pool = new Contract(contractAddress, depositPoolAbi, signer);
      const tokenAddress = await pool.token();
      const token = new Contract(tokenAddress, erc20Abi, signer);

      appendPluginLog("approve(USDCH -> DepositPool)...");
      const approveTx = await token.approve(contractAddress, amount);
      appendPluginLog(`approve tx: ${approveTx.hash}`);
      const approveReceipt = await approveTx.wait();
      if (!approveReceipt || Number(approveReceipt.status) !== 1) {
        appendPluginLog("approve reverted");
        return;
      }

      appendPluginLog("deposit(amount) submitting...");
      const depositTx = await pool.deposit(amount);
      appendPluginLog(`deposit tx: ${depositTx.hash}`);
      const depositReceipt = await depositTx.wait();
      if (!depositReceipt || Number(depositReceipt.status) !== 1) {
        appendPluginLog("deposit reverted");
        return;
      }

      const sellerAddress = await signer.getAddress();
      const [sellerDepositedRaw, sellerReservedRaw] = await Promise.all([
        pool.sellerDeposits(sellerAddress) as Promise<bigint>,
        pool.sellerReserved(sellerAddress) as Promise<bigint>
      ]);
      const sellerAvailableRaw = sellerDepositedRaw - sellerReservedRaw;

      setDepositTxHash(depositTx.hash as `0x${string}`);
      setDepositStep("platforms");
      appendPluginLog(`deposit confirmed: ${depositTx.hash}`);
      upsertSellerLiquidityRow({
        sellerAddress,
        depositedUsdc: Number(formatUnits(sellerDepositedRaw, 6)),
        reservedUsdc: Number(formatUnits(sellerReservedRaw, 6)),
        availableUsdc: Number(formatUnits(sellerAvailableRaw, 6)),
        eventDepositedUsdc: Number(formatUnits(sellerDepositedRaw, 6)),
        lastDepositTxHash: depositTx.hash,
        lastDepositBlock: Number(depositReceipt.blockNumber ?? 0),
        lastDepositAt: new Date().toISOString()
      });
      void loadChainSellerRows();
    } catch (error) {
      appendPluginLog(`deposit error: ${(error as Error).message}`);
    }
  };

  const goToReviewStep = () => {
    const normalized = wiseTag.trim().replace(/^@+/, "");
    if (!normalized) {
      appendPluginLog("请先填写 Wise tag");
      return;
    }
    if (!wiseQrDataUrl) {
      appendPluginLog("请先上传卖方真实 Wise 收款二维码");
      return;
    }

    setWiseTag(normalized);
    setDepositStep("review");
  };

  const persistSellerProfile = async (
    sellerAddress: string,
    normalizedWiseTag: string,
    qrDataUrl: string,
    qrFileName: string
  ) => {
    try {
      const response = await fetch("/api/seller-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sellerAddress,
          wiseTag: normalizedWiseTag,
          wiseQrDataUrl: qrDataUrl,
          wiseQrFileName: qrFileName
        })
      });
      if (!response.ok) {
        const payload = (await response.json()) as { detail?: string; error?: string };
        appendPluginLog(`保存卖方 Wise 信息失败: ${payload.detail ?? payload.error ?? "unknown error"}`);
        return;
      }
      const payload = (await response.json()) as { profile?: SellerProfile };
      const profile = payload.profile;
      if (!profile) return;
      setSellerProfilesByAddress((current) => ({
        ...current,
        [profile.sellerAddress.toLowerCase()]: profile
      }));
    } catch (error) {
      appendPluginLog(`保存卖方 Wise 信息失败: ${(error as Error).message}`);
    }
  };

  const createDepositRecord = async (launchPlugin: boolean) => {
    if (!walletAddress) {
      appendPluginLog("钱包未连接，无法创建 Deposit");
      return;
    }

    if (!depositTxHash) {
      appendPluginLog("未检测到 Deposit 交易哈希");
      return;
    }
    if (!wiseQrDataUrl) {
      appendPluginLog("未检测到 Wise 二维码，请返回 Add Platforms 上传");
      return;
    }

    const record: DepositRecord = {
      id: `DP-${Date.now().toString().slice(-6)}`,
      depositor: walletAddress,
      remaining: depositAmountNumber,
      locked: 0,
      taken: 0,
      platforms: ["Wise"],
      currency: "USDC",
      status: depositAmountNumber < 300 ? "low liquidity" : "healthy",
      poolState: "deposits",
      wiseTag: wiseTag.replace(/^@+/, ""),
      wiseQrDataUrl,
      wiseQrFileName: wiseQrFileName || "wise-qr",
      txHash: depositTxHash,
      createdAt: new Date().toLocaleString()
    };

    setDepositRecords((current) => [record, ...current]);
    void persistSellerProfile(record.depositor, record.wiseTag, record.wiseQrDataUrl, record.wiseQrFileName);
    void loadChainSellerRows();
    setShowDepositModal(false);
    setTradeMode("sell");
    setDepositView("deposits");

    appendPluginLog(`deposit created: ${record.id} by ${shortAddress(record.depositor)}`);

    if (launchPlugin) {
      await startPluginProofWithAmount(depositAmountNumber, "sell-deposit");
    }
  };

  const toggleRecordClosed = (id: string) => {
    setDepositRecords((current) =>
      current.map((record) => {
        if (record.id !== id) return record;
        const closed = record.poolState === "closed";
        return {
          ...record,
          poolState: closed ? "deposits" : "closed",
          status: closed ? record.status : "paused"
        };
      })
    );
  };

  useEffect(() => {
    if (sellerQuotes.length === 0) {
      setSelectedQuoteId("");
      return;
    }
    if (!sellerQuotes.some((quote) => quote.id === selectedQuoteId)) {
      setSelectedQuoteId(sellerQuotes[0].id);
    }
  }, [sellerQuotes, selectedQuoteId]);

  useEffect(() => {
    const stored = window.localStorage.getItem(sellerRecordsStorageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as DepositRecord[];
        if (Array.isArray(parsed)) {
          setDepositRecords(
            parsed.map((record) => ({
              ...record,
              wiseQrDataUrl: typeof record.wiseQrDataUrl === "string" ? record.wiseQrDataUrl : "",
              wiseQrFileName: typeof record.wiseQrFileName === "string" ? record.wiseQrFileName : "wise-qr"
            }))
          );
        }
      } catch (error) {
        console.warn("failed to parse stored seller deposits", error);
      }
    }
    setRecordsHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restoreActiveSession = async () => {
      const plugin = window.zkp2pProofPlugin;
      if (!plugin) return;

      const rootResp = await plugin.getSession().catch(() => null);
      const activeProofId = String((rootResp as { root?: { activeProofId?: string } })?.root?.activeProofId ?? "").trim();
      if (!activeProofId) return;

      const sessionResp = await plugin.getSession(activeProofId).catch(() => null);
      const session = (sessionResp as { session?: Record<string, unknown> })?.session;
      if (!session || cancelled) return;

      dispatch({ type: "new-proof", proofId: activeProofId });
      applyProofStatus(activeProofId, session.status ?? "pending");
      appendPluginLog(`恢复插件会话: ${activeProofId}`);

      const storedReleaseTx = window.localStorage.getItem(`${releaseTxStorageKeyPrefix}${activeProofId}`);
      if (storedReleaseTx) {
        setReleaseTxHash(storedReleaseTx);
        autoReleaseProofRef.current = activeProofId;
        dispatch({ type: "consume-stage", stage: "action_done" });
        appendPluginLog(`检测到该 proof 已完成 release: ${storedReleaseTx}`);
      }

      const intentId = normalizeBytes32(session.intentId);
      if (intentId) setLastReservedIntentId(intentId);

      const tuple = normalizeTuplePayload(session.tuple, activeProofId);
      if (tuple) {
        setLatestTuple(tuple);
        dispatch({ type: "buyer-ready", ok: true });
      }
    };

    void restoreActiveSession();
    return () => {
      cancelled = true;
    };
  }, [appendPluginLog, applyProofStatus]);

  useEffect(() => {
    const activeProofId = state.activeProofId;
    if (!activeProofId) return;
    if (state.proofStatus === "aggregated") return;

    let cancelled = false;

    const poll = async () => {
      const plugin = window.zkp2pProofPlugin;
      if (!plugin) return;

      const resp = await plugin.queryStatus(activeProofId).catch(() => null);
      if (!resp || cancelled) return;
      if ((resp as { ok?: boolean }).ok === false) return;

      const statusPayload = resp as {
        status?: unknown;
        statusResponse?: { status?: unknown; rawStatus?: unknown };
      };
      const rawStatus =
        statusPayload.statusResponse?.rawStatus ??
        statusPayload.statusResponse?.status ??
        statusPayload.status ??
        "pending";
      const normalized = String(rawStatus).toLowerCase();
      if (lastPolledPluginStatusRef.current !== normalized) {
        lastPolledPluginStatusRef.current = normalized;
        appendPluginLog(`status poll => ${normalized}`);
      }
      applyProofStatus(activeProofId, rawStatus);
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [appendPluginLog, applyProofStatus, state.activeProofId, state.proofStatus]);

  useEffect(() => {
    if (state.proofStatus !== "aggregated" || !state.activeProofId || state.buyerReady) return;

    const proofId = state.activeProofId;
    const current = tuplePollStartRef.current;
    if (!current || current.proofId !== proofId) {
      tuplePollStartRef.current = { proofId, startedAt: Date.now() };
    }
    const startedAt = tuplePollStartRef.current?.startedAt ?? Date.now();

    const pollTuple = async () => {
      if (Date.now() - startedAt >= TUPLE_POLL_TIMEOUT_MS) return;
      autoTupleProofRef.current = proofId;
      await runPluginAction("tuple");
    };

    void pollTuple();
    const timer = window.setInterval(() => void pollTuple(), TUPLE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [runPluginAction, state.activeProofId, state.proofStatus, state.buyerReady]);

  useEffect(() => {
    if (!canRelease || !state.activeProofId || releaseBusy) return;
    const storedReleaseTx = window.localStorage.getItem(`${releaseTxStorageKeyPrefix}${state.activeProofId}`);
    if (storedReleaseTx) {
      setReleaseTxHash(storedReleaseTx);
      dispatch({ type: "consume-stage", stage: "action_done" });
      autoReleaseProofRef.current = state.activeProofId;
      return;
    }
    if (autoReleaseProofRef.current === state.activeProofId) return;
    autoReleaseProofRef.current = state.activeProofId;
    void releaseWithAggregationProof();
  }, [canRelease, dispatch, releaseBusy, releaseWithAggregationProof, state.activeProofId]);

  useEffect(() => {
    void loadChainSellerRows();
  }, [loadChainSellerRows]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadChainSellerRows();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadChainSellerRows]);

  useEffect(() => {
    if (!recordsHydrated) return;
    try {
      window.localStorage.setItem(sellerRecordsStorageKey, JSON.stringify(depositRecords));
    } catch (error) {
      appendPluginLog(`保存卖方本地信息失败（可能二维码太大）: ${(error as Error).message}`);
    }
  }, [appendPluginLog, depositRecords, recordsHydrated]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{
        proofId: string;
        status: string;
      }>;

      const payload = custom.detail;
      if (!payload?.proofId) return;

      appendPluginLog(`plugin status => ${payload.status} (${payload.proofId})`);
      applyProofStatus(payload.proofId, payload.status);
    };

    window.addEventListener("zkp2p-plugin-status", handler as EventListener);
    return () => window.removeEventListener("zkp2p-plugin-status", handler as EventListener);
  }, [appendPluginLog, applyProofStatus]);

  return (
    <main className="zkp2p-shell">
      <header className="zk-topbar">
        <div className="zk-brand-row">
          <div className="zk-logo" aria-hidden="true" />
          <span className="zk-beta">Beta</span>

          <nav className="zk-main-nav" aria-label="Primary">
            <button
              className={tradeMode === "buy" ? "active" : ""}
              onClick={() => setTradeMode("buy")}
              type="button"
            >
              Buy
            </button>
            <button
              className={tradeMode === "sell" ? "active" : ""}
              onClick={() => setTradeMode("sell")}
              type="button"
            >
              Sell
            </button>
          </nav>
        </div>

        <div className="zk-account-row">
          <button className="zk-mini-pill" type="button">
            Horizen EON
          </button>
          <button className="zk-account-pill" onClick={connectWallet} type="button">
            {walletAddress ? shortAddress(walletAddress) : "Connect Wallet"}
          </button>
        </div>
      </header>

      {tradeMode === "buy" ? (
        <section className={`zk-content-grid ${showQuotes ? "" : "single"}`}>
          <article className="zk-left-panel">
            <div className="zk-trade-card">
              <div className="zk-field-card">
                <p>You send</p>
                <div className="zk-field-main">
                  <input
                    aria-label="You send amount"
                    value={sendAmount}
                    onChange={(event) => setSendAmount(event.target.value)}
                    placeholder="0"
                  />
                  <button className="zk-pill-asset" type="button">
                    HKD ▾
                  </button>
                </div>
              </div>

              <div className="zk-field-card slim">
                <p>Paying using</p>
                <div className="zk-field-main">
                  <span className="zk-empty" />
                  <button className="zk-pill-asset" type="button">
                    Wise ▾
                  </button>
                </div>
              </div>

              <div className="zk-field-card">
                <p>You receive</p>
                <div className="zk-field-main">
                  <div>
                    <strong>{toFixed2(receiveUsdc)}</strong>
                    <span>HK${toFixed2(receiveUsdc)}</span>
                  </div>
                  <button className="zk-pill-asset" type="button">
                    USDC ▾
                  </button>
                </div>
                <small>1 HKD = 1 USDC (release path)</small>
              </div>

              <div className="zk-rate-line">
                {toFixed2(sendAmountNumber)} HKD → {toFixed2(receiveUsdc)} USDC (HK${toFixed2(receiveUsdc)})
              </div>

              <div className="zk-selected-seller-line">
                {selectedQuote
                  ? `Seller ${selectedQuote.sellerLabel} · Available ${toFixed2(selectedQuote.availableUsdc)} USDC`
                  : "No seller liquidity yet. Seller must deposit on-chain and upload Wise tag + QR first."}
              </div>

              <button className="zk-ghost-btn" type="button">
                + Add Custom Recipient
              </button>

              <button
                className="zk-primary-btn"
                disabled={!canStartOrder}
                  onClick={() => void openSellerQrModal()}
                  type="button"
                >
                {pluginBusy ? "Working..." : "Start Order"}
              </button>

              <div className="zk-wallet-row">
                <span>{walletAddress ? "Wallet connected" : "Wallet required"}</span>
                <button onClick={connectWallet} type="button">
                  {walletAddress ? "Connected" : "Connect"}
                </button>
              </div>
            </div>
          </article>

          {showQuotes ? (
            <aside className="zk-right-panel">
              <div className="zk-quote-panel">
                <header>
                  <h2>Select a Quote</h2>
                  <button aria-label="close" type="button">
                    ✕
                  </button>
                </header>

                <div className="zk-quote-list">
                  {sellerQuotes.length === 0 ? (
                    <div className="zk-empty-quote-state">
                      <strong>No seller quotes yet</strong>
                      <span>
                        {chainSellerRows.length > 0
                          ? "Sellers found on-chain. Refresh page and complete Wise setup in Sell > Add Platforms."
                          : "Need on-chain seller liquidity + Wise tag + QR."}
                      </span>
                    </div>
                  ) : (
                    sellerQuotes.map((quote) => (
                      <button
                        key={quote.id}
                        className={`zk-quote-item ${selectedQuoteId === quote.id ? "selected" : ""} ${
                          quote.fillable ? "" : "disabled"
                        }`}
                        disabled={!quote.fillable}
                        onClick={() => setSelectedQuoteId(quote.id)}
                        type="button"
                      >
                        <div>
                          <strong>{toFixed2(quote.receiveUsdc)} USDC</strong>
                          <small>
                            ≈ HK${toFixed2(quote.hkdValue)} · {quote.spreadLabel}
                          </small>
                          <small className="zk-quote-liquidity">
                            Available: {toFixed2(quote.availableUsdc)} USDC
                          </small>
                          {!quote.hasWiseSetup ? (
                            <small className="zk-quote-shortfall">Seller has no Wise tag/QR yet</small>
                          ) : null}
                          {!quote.fillable && quote.shortfallUsdc > 0 ? (
                            <small className="zk-quote-shortfall">
                              Short by {toFixed2(quote.shortfallUsdc)} USDC
                            </small>
                          ) : null}
                        </div>
                        <div>
                          <span>{quote.sellerLabel}</span>
                          <small>{quote.method}</small>
                          <small>{shortAddress(quote.sellerAddress)}</small>
                          {quote.best ? <em>BEST</em> : null}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </aside>
          ) : null}
        </section>
      ) : (
        <section className="zk-sell-layout">
          <div className="zk-sell-head">
            <div className="zk-sell-tabs">
              <button
                className={depositView === "deposits" ? "active" : ""}
                onClick={() => setDepositView("deposits")}
                type="button"
              >
                Deposits
              </button>
              <button
                className={depositView === "closed" ? "active" : ""}
                onClick={() => setDepositView("closed")}
                type="button"
              >
                Closed
              </button>
            </div>

            <button className="zk-new-deposit" onClick={openDepositModal} type="button">
              + New Deposit
            </button>
          </div>

          <article className="zk-deposit-table-wrap">
            <table className="zk-deposit-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Remaining</th>
                  <th>Locked</th>
                  <th>Taken</th>
                  <th>Platforms</th>
                  <th>Wise Handle</th>
                  <th>Currencies</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="zk-empty-row">
                      <div>
                        <strong>No deposits yet</strong>
                        <span>Click "New Deposit" to start: Deposit Amount → Add Platforms → Review & Create</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  visibleRecords.map((record, index) => (
                    <tr key={record.id}>
                      <td>
                        <div className="zk-table-index">{index + 1}</div>
                        <div className="zk-table-sub">
                          {record.id} · {shortAddress(record.depositor)}
                        </div>
                      </td>
                      <td>{toFixed2(record.remaining)}</td>
                      <td>{toFixed2(record.locked)}</td>
                      <td>{toFixed2(record.taken)}</td>
                      <td>{record.platforms.join(", ")}</td>
                      <td>{record.wiseTag ? `@${record.wiseTag}` : "Not set"}</td>
                      <td>{record.currency}</td>
                      <td>
                        <span className={`zk-status-pill ${record.status.replace(" ", "-")}`}>
                          {record.status}
                        </span>
                        <button
                          className="zk-inline-toggle"
                          onClick={() => toggleRecordClosed(record.id)}
                          type="button"
                        >
                          {record.poolState === "closed" ? "Reopen" : "Close"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </article>
        </section>
      )}

      <section className="zk-flow-card">
        <h3>Proof Flow (Plugin + Aggregation)</h3>

        <div className="zk-flow-states">
          <span className={state.proofStatus === "pending" ? "on" : ""}>pending</span>
          <span className={state.proofStatus === "verified" ? "on" : ""}>verified</span>
          <span className={state.proofStatus === "aggregated" ? "on" : ""}>aggregated</span>
        </div>

        <div className="zk-consume-states">
          {consumeSequence.map((stage) => (
            <button
              key={stage}
              className={state.consumeStage === stage ? "on" : ""}
              onClick={() => dispatch({ type: "consume-stage", stage })}
              type="button"
            >
              {stage}
            </button>
          ))}
        </div>

        <div className="zk-plugin-actions">
          <button disabled={pluginBusy} onClick={() => runPluginAction("capture")} type="button">
            Capture
          </button>
          <button disabled={pluginBusy} onClick={() => runPluginAction("prove")} type="button">
            Prove
          </button>
          <button disabled={pluginBusy} onClick={() => runPluginAction("submit")} type="button">
            Submit
          </button>
          <button disabled={pluginBusy} onClick={() => runPluginAction("status")} type="button">
            Status
          </button>
          <button disabled={pluginBusy} onClick={() => runPluginAction("tuple")} type="button">
            Tuple
          </button>
          <button onClick={() => dispatch({ type: "buyer-ready", ok: !state.buyerReady })} type="button">
            {state.buyerReady ? "Unset Buyer Ready" : "Mark Buyer Ready"}
          </button>
        </div>

        <div className="zk-release-gate">
          <p>activeProofId: {state.activeProofId ?? "none"}</p>
          <p>lastIntentId: {lastReservedIntentId ?? "none"}</p>
          <p>raw status: {state.rawStatus}</p>
          <p>buyer-ready: {state.buyerReady ? "YES" : "WAIT"}</p>
          <button disabled={!canRelease || releaseBusy} onClick={() => void releaseWithAggregationProof()} type="button">
            {releaseBusy ? "Releasing..." : "Sign & Release"}
          </button>
          <p>release tx: {releaseTxHash ?? "none"}</p>
        </div>

        <pre>{pluginLogs.join("\n") || "Plugin logs will appear here."}</pre>
      </section>

      {showSellerQrModal && pendingQrOrder ? (
        <div className="zk-modal-mask" role="dialog" aria-modal="true">
          <div className="zk-qr-modal-card">
            <header>
              <h3>Scan Seller QR</h3>
              <button onClick={closeSellerQrModal} type="button">
                ✕
              </button>
            </header>

            <p>
              Quota is already locked on-chain. Scan this QR with Wise to pay{" "}
              <strong>{pendingQrOrder.quote.sellerLabel}</strong>, then continue to launch plugin capture.
            </p>

            <div className="zk-qr-wrap">
              <img
                alt={`Wise QR for ${pendingQrOrder.quote.sellerLabel}`}
                src={pendingQrOrder.quote.wiseQrDataUrl}
              />
            </div>

            <div className="zk-qr-detail">
              <span>Seller: {pendingQrOrder.quote.sellerLabel}</span>
              <span>Wise: @{pendingQrOrder.quote.wiseTag}</span>
              <span>QR: {pendingQrOrder.quote.wiseQrFileName}</span>
              <span>Pay HKD: {toFixed2(pendingQrOrder.sendAmountHkd)}</span>
              <span>Receive USDC: {toFixed2(pendingQrOrder.receiveUsdc)}</span>
              <span>Intent: {pendingQrOrder.reservation.intentId.slice(0, 10)}...</span>
            </div>

            <div className="zk-modal-actions">
              <button className="primary" onClick={launchBuyerOrderAfterQr} type="button">
                I Paid, Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDepositModal ? (
        <div className="zk-modal-mask" role="dialog" aria-modal="true">
          <div className="zk-modal-card">
            <header>
              <button
                onClick={() => {
                  if (depositStep === "review") {
                    setDepositStep("platforms");
                    return;
                  }
                  if (depositStep === "platforms") {
                    setDepositStep("amount");
                    return;
                  }
                  setShowDepositModal(false);
                }}
                type="button"
              >
                ←
              </button>
              <h3>New Deposit</h3>
              <button onClick={() => setShowDepositModal(false)} type="button">
                ✕
              </button>
            </header>

            <div className="zk-modal-stepper">
              <div className={`zk-step-node ${depositStep === "amount" ? "active" : "done"}`}>
                <span>1</span>
                <p>Deposit Amount</p>
              </div>
              <div className={`zk-step-node ${depositStep === "platforms" ? "active" : depositStep === "review" ? "done" : ""}`}>
                <span>2</span>
                <p>Add Platforms</p>
              </div>
              <div className={`zk-step-node ${depositStep === "review" ? "active" : ""}`}>
                <span>3</span>
                <p>Review & Create</p>
              </div>
            </div>

            {depositStep === "amount" ? (
              <section>
                <h4>Amount to Deposit</h4>

                <div className="zk-form-card">
                  <label>
                    Deposit Amount
                    <div className="zk-input-line">
                      <input
                        value={depositAmount}
                        onChange={(event) => setDepositAmount(event.target.value)}
                        placeholder="0"
                      />
                      <button type="button">USDC ▾</button>
                    </div>
                  </label>

                  <label>
                    Telegram Username (Optional)
                    <input
                      value={telegramUsername}
                      onChange={(event) => setTelegramUsername(event.target.value)}
                      placeholder="@username"
                    />
                  </label>
                </div>

                <div className="zk-modal-actions">
                  <button className="secondary" onClick={() => setShowDepositModal(false)} type="button">
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={!walletAddress || depositAmountNumber <= 0}
                    onClick={submitDepositAmountStep}
                    type="button"
                  >
                    Add Platforms
                  </button>
                </div>
              </section>
            ) : null}

            {depositStep === "platforms" ? (
              <section>
                <div className="zk-section-row">
                  <h4>Payment Platforms</h4>
                  <button type="button">+ Add Platform</button>
                </div>

                <div className="zk-form-card">
                  <div className="zk-platform-row">
                    <strong>Wise</strong>
                    <span>Setup Required</span>
                  </div>

                  <label>
                    Wisetag
                    <input
                      value={wiseTag}
                      onChange={(event) => setWiseTag(event.target.value)}
                      placeholder="jianjinl"
                    />
                  </label>

                  <label>
                    Wise QR (Required)
                    <input
                      className="zk-file-input"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          setWiseQrDataUrl("");
                          setWiseQrFileName("");
                          return;
                        }
                        if (!file.type.startsWith("image/")) {
                          appendPluginLog("二维码文件必须是图片格式");
                          event.target.value = "";
                          setWiseQrDataUrl("");
                          setWiseQrFileName("");
                          return;
                        }

                        const reader = new FileReader();
                        reader.onload = () => {
                          const result = typeof reader.result === "string" ? reader.result : "";
                          if (!result) {
                            appendPluginLog("二维码读取失败，请重试");
                            return;
                          }
                          setWiseQrDataUrl(result);
                          setWiseQrFileName(file.name);
                          appendPluginLog(`Wise QR 已上传: ${file.name}`);
                        };
                        reader.onerror = () => {
                          appendPluginLog("二维码读取失败，请重试");
                          setWiseQrDataUrl("");
                          setWiseQrFileName("");
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>

                  {wiseQrDataUrl ? (
                    <div className="zk-upload-preview">
                      <img alt="Uploaded Wise QR preview" src={wiseQrDataUrl} />
                      <span>{wiseQrFileName || "wise-qr"}</span>
                    </div>
                  ) : (
                    <p className="zk-upload-required">必须上传卖方真实 Wise 收款二维码</p>
                  )}

                  <p>Make sure there are no typos. Do not include the @ symbol.</p>

                  <div className="zk-warning-box">
                    Wise currently requires manual approval. Please submit your Wisetag and allow up to 24 hours for approval.
                    <a href="https://wise.com" target="_blank" rel="noreferrer">
                      Click here to fill out the form ↗
                    </a>
                  </div>
                </div>

                <div className="zk-modal-actions">
                  <button className="secondary" onClick={() => setDepositStep("amount")} type="button">
                    Back
                  </button>
                  <button className="primary" disabled={!wiseTag.trim() || !wiseQrDataUrl} onClick={goToReviewStep} type="button">
                    Review & Create
                  </button>
                </div>
              </section>
            ) : null}

            {depositStep === "review" ? (
              <section>
                <h4>Review & Create</h4>

                <div className="zk-form-card">
                  <div className="zk-review-row">
                    <span>Deposit Amount</span>
                    <strong>{toFixed2(depositAmountNumber)} USDC</strong>
                  </div>
                  <div className="zk-review-row">
                    <span>Platform</span>
                    <strong>Wise</strong>
                  </div>
                  <div className="zk-review-row">
                    <span>Wise Tag</span>
                    <strong>@{wiseTag.replace(/^@+/, "")}</strong>
                  </div>
                  <div className="zk-review-row">
                    <span>Wise QR</span>
                    <strong>{wiseQrFileName || "required"}</strong>
                  </div>
                  {wiseQrDataUrl ? (
                    <div className="zk-review-qr-preview">
                      <img alt="Wise QR preview" src={wiseQrDataUrl} />
                    </div>
                  ) : null}
                  <div className="zk-review-row">
                    <span>Depositor</span>
                    <strong>{walletAddress ? shortAddress(walletAddress) : "wallet required"}</strong>
                  </div>
                  <div className="zk-review-row">
                    <span>Deposit Tx</span>
                    <strong>
                      {depositTxHash
                        ? `${depositTxHash.slice(0, 8)}...${depositTxHash.slice(-6)}`
                        : "pending"}
                    </strong>
                  </div>
                </div>

                <div className="zk-modal-actions">
                  <button className="secondary" onClick={() => setDepositStep("platforms")} type="button">
                    Back
                  </button>
                  <button className="secondary" onClick={() => createDepositRecord(false)} type="button">
                    Create New
                  </button>
                  <button className="primary" onClick={() => createDepositRecord(true)} type="button">
                    Create & Launch Plugin
                  </button>
                </div>
              </section>
            ) : null}

            {latestLog ? <p className="zk-inline-status">{latestLog}</p> : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
