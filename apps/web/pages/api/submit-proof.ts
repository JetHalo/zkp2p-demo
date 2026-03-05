import type { NextApiRequest, NextApiResponse } from "next";
import {
  validateSubmitRequest,
  type ProofStatusResponse,
  type ProofSubmitRequest
} from "@/src/zk/zkp2p-horizen-release/schemas";
import {
  releaseNullifier,
  releaseWiseReceiptHash,
  reserveNullifier,
  reserveWiseReceiptHash,
  upsertStatus
} from "@/src/zk/zkp2p-horizen-release/store/proof-store";
import { getKurierSubmitEnv } from "@/src/zk/zkp2p-horizen-release/api/kurier";

type ErrorResponse = {
  error: string;
  details?: string[];
  availableKeys?: string[];
  source?: string;
  attempts?: Array<{ status: number; endpoint: string; availableKeys: string[]; message: string; rawPreview?: string }>;
};

type SubmitTarget = {
  endpoint: string;
  useBearer: boolean;
};

type UpstreamResult = {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
  endpoint: string;
};

function normalizeId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return "";
}

function looksLikeProviderJobId(id: string): boolean {
  if (!id) return false;
  // Kurier job ids are UUID-like; never treat local proof-... ids as provider job ids.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function findProviderJobIdDeep(input: unknown, depth = 0): string {
  if (depth > 8 || input == null) return "";
  if (Array.isArray(input)) {
    for (const item of input) {
      const got = findProviderJobIdDeep(item, depth + 1);
      if (got) return got;
    }
    return "";
  }
  if (typeof input !== "object") return "";
  const row = input as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    const lower = key.toLowerCase();
    const value = row[key];
    if (
      lower === "jobid" ||
      lower === "job_id" ||
      lower === "taskid" ||
      lower === "requestid" ||
      lower === "proofjobid" ||
      lower === "id"
    ) {
      const id = normalizeId(value);
      if (looksLikeProviderJobId(id)) return id;
    }
    if (lower.includes("job") && !Array.isArray(value) && (typeof value === "string" || typeof value === "number")) {
      const id = normalizeId(value);
      if (looksLikeProviderJobId(id)) return id;
    }
  }
  for (const child of Object.values(row)) {
    const got = findProviderJobIdDeep(child, depth + 1);
    if (got) return got;
  }
  return "";
}

function extractProviderJobId(raw: Record<string, unknown>): string {
  const deep = findProviderJobIdDeep(raw);
  if (deep) return deep;

  // Last-resort heuristic for UUID-like ids.
  const rawText = JSON.stringify(raw);
  const uuid = rawText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (uuid?.[0]) return uuid[0];
  return "";
}

function normalizeBaseUrl(urlText: string): string {
  return String(urlText).replace(/\/+$/, "");
}

function stripApiVersion(baseUrl: string): string {
  return baseUrl.replace(/\/api\/v\d+$/i, "");
}

function uniqueTargets(targets: SubmitTarget[]): SubmitTarget[] {
  const seen = new Set<string>();
  const out: SubmitTarget[] = [];
  for (const target of targets) {
    const key = `${target.endpoint}::${target.useBearer ? "bearer" : "no-bearer"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

function buildSubmitTargets(env: ReturnType<typeof getKurierSubmitEnv>): SubmitTarget[] {
  const apiBase = normalizeBaseUrl(env.apiUrl);
  const rootBase = stripApiVersion(apiBase);
  const targets: SubmitTarget[] = [
    { endpoint: `${apiBase}/proofs/submit`, useBearer: true },
    { endpoint: `${apiBase}/submit-proof/${env.apiKey}`, useBearer: false },
    { endpoint: `${apiBase}/submit-proof/${env.apiKey}`, useBearer: true }
  ];

  if (rootBase && rootBase !== apiBase) {
    targets.push({ endpoint: `${rootBase}/submit-proof/${env.apiKey}`, useBearer: false });
    targets.push({ endpoint: `${rootBase}/submit-proof/${env.apiKey}`, useBearer: true });
    targets.push({ endpoint: `${rootBase}/api/v1/submit-proof/${env.apiKey}`, useBearer: false });
    targets.push({ endpoint: `${rootBase}/api/v1/submit-proof/${env.apiKey}`, useBearer: true });
  }

  return uniqueTargets(targets);
}

async function postSubmitCandidate(
  target: SubmitTarget,
  apiKey: string,
  body: Record<string, unknown>
): Promise<UpstreamResult> {
  const resp = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(target.useBearer ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify(body)
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: resp.ok,
    status: resp.status,
    json,
    endpoint: target.endpoint
  };
}

function buildKurierSubmitBodies(
  payload: ProofSubmitRequest,
  env: ReturnType<typeof getKurierSubmitEnv>
): Array<Record<string, unknown>> {
  const ensureHexBytes = (value: unknown): string => {
    const text = String(value ?? "").trim();
    if (!text) return "0x0";
    if (/^0x[0-9a-fA-F]+$/.test(text)) return `0x${text.slice(2).toLowerCase()}`;
    if (!/^[0-9]+$/.test(text)) {
      throw new Error(`invalid public input format: ${text}`);
    }
    return `0x${BigInt(text).toString(16)}`;
  };

  const toFieldHex32 = (value: unknown): string => {
    const rawHex = ensureHexBytes(value).slice(2);
    if (rawHex.length > 64) {
      throw new Error(`public signal overflows field width: 0x${rawHex}`);
    }
    return `0x${rawHex.padStart(64, "0")}`;
  };

  const normalizedPublicSignals = payload.publicInputs.map(toFieldHex32);
  const normalizedProof = ensureHexBytes(payload.proof);

  const proofOptions = {
    variant: env.proofVariant,
    numberOfPublicInputs: payload.publicInputs.length
  };

  // Try strict Kurier-style payload first, then keep legacy shape as fallback.
  const modern = {
    proofType: payload.proofSystem,
    proofOptions,
    vkRegistered: true,
    proofData: {
      vk: env.vkHash,
      proof: normalizedProof,
      publicSignals: normalizedPublicSignals
    },
    mode: payload.verificationMode,
    appId: payload.appId,
    businessDomain: payload.businessDomain,
    aggregationDomainId: payload.aggregationDomainId,
    userAddr: payload.userAddr,
    chainId: payload.chainId,
    timestamp: payload.timestamp,
    intentId: payload.intentId,
    intentHash: payload.intentHash,
    amount: payload.amount,
    nullifier: payload.nullifier
  };

  const legacy = {
    mode: payload.verificationMode,
    proofSystem: payload.proofSystem,
    proofType: payload.proofSystem,
    proofOptions,
    appId: payload.appId,
    businessDomain: payload.businessDomain,
    aggregationDomainId: payload.aggregationDomainId,
    userAddr: payload.userAddr,
    chainId: payload.chainId,
    timestamp: payload.timestamp,
    intentId: payload.intentId,
    intentHash: payload.intentHash,
    amount: payload.amount,
    nullifier: payload.nullifier,
    proof: normalizedProof,
    publicInputs: normalizedPublicSignals,
    proofData: {
      vk: env.vkHash,
      proof: normalizedProof,
      publicSignals: normalizedPublicSignals
    },
    vkRegistered: true,
    vkHash: env.vkHash
  };

  return [modern, legacy];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProofStatusResponse | ErrorResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const validation = validateSubmitRequest(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: "invalid payload", details: validation.errors });
  }

  const payload = req.body as ProofSubmitRequest;

  let env: ReturnType<typeof getKurierSubmitEnv>;
  try {
    env = getKurierSubmitEnv();
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }

  if (payload.appId !== env.appId) {
    return res.status(400).json({ error: "appId mismatch with server env" });
  }

  if (payload.aggregationDomainId !== env.aggregationDomainId) {
    return res.status(400).json({ error: "aggregationDomainId mismatch with server env" });
  }

  const nullifierReserved = reserveNullifier(payload.nullifier);
  if (!nullifierReserved) {
    return res.status(409).json({ error: "anti-replay violation: nullifier already seen" });
  }

  const wiseReceiptReserved = reserveWiseReceiptHash(payload.wiseReceiptHash);
  if (!wiseReceiptReserved) {
    releaseNullifier(payload.nullifier);
    return res.status(409).json({ error: "anti-replay violation: wise receipt hash already seen" });
  }

  const attempts: Array<{
    status: number;
    endpoint: string;
    availableKeys: string[];
    message: string;
    rawPreview?: string;
  }> = [];
  let upstream: UpstreamResult | null = null;
  for (const body of buildKurierSubmitBodies(payload, env)) {
    for (const target of buildSubmitTargets(env)) {
      upstream = await postSubmitCandidate(target, env.apiKey, body);
      const raw = upstream.json;
      if (upstream.ok) break;
      attempts.push({
        status: upstream.status,
        endpoint: upstream.endpoint,
        availableKeys: Object.keys(raw),
        message: String(raw.message ?? raw.error ?? "submit failed"),
        rawPreview: JSON.stringify(raw).slice(0, 300)
      });
      // Route not found -> keep trying compatibility fallbacks.
      if (upstream.status !== 404) {
        // Non-404 means endpoint exists but payload/permission/state failed.
        // Try next payload shape, not endless endpoint probing.
        break;
      }
    }
    if (upstream?.ok) break;
  }

  if (!upstream) {
    releaseNullifier(payload.nullifier);
    releaseWiseReceiptHash(payload.wiseReceiptHash);
    return res.status(500).json({ error: "kurier submit failed: no request attempted" });
  }

  const raw = upstream.json;
  if (!upstream.ok) {
    releaseNullifier(payload.nullifier);
    releaseWiseReceiptHash(payload.wiseReceiptHash);
    const attemptDetails = attempts.map(
      (item) =>
        `status=${item.status} endpoint=${item.endpoint} message=${item.message}${item.rawPreview ? ` raw=${item.rawPreview}` : ""}`
    );
    return res.status(upstream.status).json({
      error: "kurier submit failed",
      details: attemptDetails,
      availableKeys: Object.keys(raw),
      source: "kurier-keyed",
      attempts
    });
  }

  const providerJobId = extractProviderJobId(raw);
  if (!providerJobId) {
    releaseNullifier(payload.nullifier);
    releaseWiseReceiptHash(payload.wiseReceiptHash);
    return res.status(502).json({
      error: "kurier submit response missing jobId",
      details: [JSON.stringify(raw).slice(0, 500)],
      availableKeys: Object.keys(raw),
      source: "kurier-keyed"
    });
  }

  const rawStatus = String(raw.status ?? raw.optimisticVerify ?? "pending");
  const normalizedRawStatus = rawStatus.toLowerCase();
  const failed =
    normalizedRawStatus.includes("fail") ||
    normalizedRawStatus.includes("error") ||
    (typeof raw.error === "string" && raw.error.trim().length > 0);
  if (failed) {
    releaseNullifier(payload.nullifier);
    releaseWiseReceiptHash(payload.wiseReceiptHash);
  }

  const status: ProofStatusResponse = {
    proofId: payload.proofId,
    status: failed ? "failed" : "pending",
    rawStatus,
    updatedAt: new Date().toISOString(),
    source: "kurier-keyed",
    availableKeys: Object.keys(raw),
    providerJobId,
    intentHash: payload.intentHash,
    nullifier: payload.nullifier
  };
  if (failed && typeof raw.error === "string" && raw.error.trim()) {
    status.error = raw.error.trim();
  }

  upsertStatus(status);
  return res.status(200).json(status);
}
