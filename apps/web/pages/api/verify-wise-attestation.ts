import crypto from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";

type VerifyWiseAttestationRequest = {
  proofId?: string;
  attestation?: unknown;
  selectedTransfer?: {
    amount?: string;
    timestamp?: number | string;
    payerRef?: string;
    transferId?: string;
    status?: string;
    currency?: string;
  };
  recentCount?: number;
  expected?: {
    amount?: string;
    userAddr?: string;
    timestamp?: number;
    transferId?: string;
  };
};

type VerifyWiseAttestationResponse =
  | {
      verified: true;
      wiseReceiptHash: string;
      normalized: {
        amount: string;
        timestamp: number;
        payerRef: string;
        transferId: string;
        sourceHost: string;
      };
      verifier: {
        status: string;
        availableKeys: string[];
      };
    }
  | {
      error: string;
      details?: string[];
      availableKeys?: string[];
    };

function sha256Hex(value: string): string {
  return `0x${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function pickString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = input[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const parsed = Number(v.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object") return {};
  return v as Record<string, unknown>;
}

function isUnsignedIntegerText(v: string): boolean {
  return /^[0-9]+$/.test(v.trim());
}

function normalizeTransferId(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isValidTransferId(v: string): boolean {
  if (!v) return false;
  // Keep validation strict enough to reject junk, but flexible for Wise id formats.
  // Allowed: alphanumeric + underscore + hyphen + dot + colon.
  return /^[A-Za-z0-9_.:-]{6,128}$/.test(v);
}

function parseAllowedHostSuffixes(raw: string | undefined): string[] {
  const value = raw ?? "wise.com,transferwise.com";
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesAllowedSuffix(sourceHost: string, suffixes: string[]): boolean {
  const host = sourceHost.trim().toLowerCase();
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function normalizeVerifierData(raw: Record<string, unknown>): {
  amount?: string;
  timestamp?: number;
  payerRef?: string;
  transferId?: string;
  sourceHost?: string;
} {
  const nested = asRecord(raw.claimData ?? raw.extracted ?? raw.normalized ?? raw.data ?? raw.fields);

  const view = { ...raw, ...nested };
  const amount = pickString(view, ["amount", "amountText", "transferAmount", "paymentAmount"]);
  const timestamp = pickNumber(view, ["timestamp", "transferTimestamp", "createdAtTs", "paidAt"]);
  const payerRef = pickString(view, ["payerRef", "payer", "sender", "payerId", "accountHolder"]);
  const transferId = pickString(view, [
    "transferId",
    "paymentId",
    "transactionId",
    "transactionNumber",
    "transactionNo",
    "transaction_number",
    "id"
  ]);
  const sourceHost = pickString(view, ["sourceHost", "host", "domain", "originHost"]);

  return {
    amount,
    timestamp,
    payerRef,
    transferId,
    sourceHost
  };
}

function isVerifierSuccess(raw: Record<string, unknown>): boolean {
  const flags = [raw.verified, raw.ok, raw.success, raw.valid];
  return flags.some((v) => v === true || v === "true");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VerifyWiseAttestationResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const payload = req.body as VerifyWiseAttestationRequest;
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "payload must be object" });
  }

  if (!payload.attestation) {
    return res.status(400).json({ error: "attestation is required" });
  }

  const expectedTransferId = normalizeTransferId(payload.expected?.transferId);
  if (!expectedTransferId) {
    return res.status(400).json({
      error: "expected.transferId is required"
    });
  }
  if (!isValidTransferId(expectedTransferId)) {
    return res.status(400).json({
      error: "expected.transferId has invalid format"
    });
  }

  const verifierUrl = process.env.TLSN_VERIFIER_URL;
  if (!verifierUrl) {
    return res.status(500).json({
      error: "missing TLSN_VERIFIER_URL (server-side verifier endpoint)"
    });
  }

  const token = process.env.TLSN_VERIFIER_TOKEN;

  const upstream = await fetch(verifierUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      proofId: payload.proofId ?? "",
      attestation: payload.attestation,
      selectedTransfer: payload.selectedTransfer,
      recentCount: payload.recentCount,
      expected: payload.expected
    })
  });

  const raw = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  const availableKeys = Object.keys(raw);

  if (!upstream.ok || !isVerifierSuccess(raw)) {
    return res.status(400).json({
      error: "tlsn verifier rejected attestation",
      availableKeys
    });
  }

  const normalized = normalizeVerifierData(raw);
  const allowedHostSuffixes = parseAllowedHostSuffixes(process.env.TLSN_ALLOWED_HOST_SUFFIXES);
  const details: string[] = [];
  if (!normalized.amount) details.push("amount missing in verifier output");
  if (!normalized.timestamp) details.push("timestamp missing in verifier output");
  if (!normalized.payerRef) details.push("payerRef missing in verifier output");
  if (!normalized.transferId) details.push("transferId missing in verifier output");
  if (!normalized.sourceHost) details.push("sourceHost missing in verifier output");
  if (details.length > 0) {
    return res.status(400).json({
      error: "verifier output missing required Wise fields",
      details,
      availableKeys
    });
  }

  const normalizedTransferId = normalizeTransferId(normalized.transferId);
  if (!isValidTransferId(normalizedTransferId)) {
    return res.status(400).json({
      error: "transferId has invalid format in verifier output",
      details: [`transferId=${String(normalized.transferId ?? "")}`],
      availableKeys
    });
  }

  if (!hostMatchesAllowedSuffix(normalized.sourceHost as string, allowedHostSuffixes)) {
    return res.status(400).json({
      error: "sourceHost is not an allowed Wise domain",
      details: [
        `sourceHost=${normalized.sourceHost as string}`,
        `allowed=${allowedHostSuffixes.join(",")}`
      ],
      availableKeys
    });
  }

  if (
    payload.expected?.amount &&
    isUnsignedIntegerText(payload.expected.amount) &&
    isUnsignedIntegerText(normalized.amount as string) &&
    payload.expected.amount !== normalized.amount
  ) {
    return res.status(400).json({
      error: "amount mismatch with expected order amount",
      details: [`expected=${payload.expected.amount}`, `actual=${normalized.amount}`],
      availableKeys
    });
  }

  if (
    typeof payload.expected?.timestamp === "number" &&
    Number.isFinite(payload.expected.timestamp) &&
    Math.abs(Math.trunc(payload.expected.timestamp) - Math.trunc(normalized.timestamp as number)) > 30 * 60
  ) {
    return res.status(400).json({
      error: "timestamp out of allowed skew (30m)",
      details: [
        `expected=${Math.trunc(payload.expected.timestamp)}`,
        `actual=${Math.trunc(normalized.timestamp as number)}`
      ],
      availableKeys
    });
  }

  if (normalizedTransferId !== expectedTransferId) {
    return res.status(400).json({
      error: "transferId mismatch with selected payment",
      details: [`expected=${expectedTransferId}`, `actual=${normalizedTransferId}`],
      availableKeys
    });
  }

  const attestationDigest = sha256Hex(JSON.stringify(payload.attestation));
  const wiseReceiptHash = sha256Hex(
    [
      "wise",
      normalized.sourceHost,
      normalizedTransferId,
      normalized.payerRef,
      normalized.amount,
      String(Math.trunc(normalized.timestamp as number)),
      attestationDigest
    ].join("|")
  );

  return res.status(200).json({
    verified: true,
    wiseReceiptHash,
    normalized: {
      amount: normalized.amount as string,
      timestamp: Math.trunc(normalized.timestamp as number),
      payerRef: normalized.payerRef as string,
      transferId: normalizedTransferId,
      sourceHost: normalized.sourceHost as string
    },
    verifier: {
      status: "ok",
      availableKeys
    }
  });
}
