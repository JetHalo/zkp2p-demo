import type { NextApiRequest, NextApiResponse } from "next";
import type { ProofAggregationTuple } from "@/src/zk/zkp2p-horizen-release/schemas";
import { getStatus, getTuple, upsertTuple } from "@/src/zk/zkp2p-horizen-release/store/proof-store";
import { getKurierEnv } from "@/src/zk/zkp2p-horizen-release/api/kurier";

type ErrorResponse = {
  error: string;
  details?: string[];
  availableKeys?: string[];
  source?: string;
  attempts?: Array<{ status: number; endpoint: string; message: string; availableKeys: string[]; rawPreview?: string }>;
};

type UpstreamResult = {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
  endpoint: string;
};

type StatusTarget = {
  endpoint: string;
  useBearer: boolean;
};

function normalizeBaseUrl(urlText: string): string {
  return String(urlText).replace(/\/+$/, "");
}

function stripApiVersion(baseUrl: string): string {
  return baseUrl.replace(/\/api\/v\d+$/i, "");
}

function uniqueStatusTargets(targets: StatusTarget[]): StatusTarget[] {
  const seen = new Set<string>();
  const out: StatusTarget[] = [];
  for (const target of targets) {
    const key = `${target.endpoint}::${target.useBearer ? "bearer" : "no-bearer"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

function buildJobStatusTargets(apiUrl: string, apiKey: string, providerJobId: string): StatusTarget[] {
  const apiBase = normalizeBaseUrl(apiUrl);
  const rootBase = stripApiVersion(apiBase);
  const encodedApiKey = encodeURIComponent(apiKey);
  const encodedJobId = encodeURIComponent(providerJobId);
  const targets: StatusTarget[] = [
    { endpoint: `${apiBase}/job-status/${encodedApiKey}/${encodedJobId}`, useBearer: false },
    { endpoint: `${apiBase}/job-status/${encodedApiKey}/${encodedJobId}`, useBearer: true }
  ];
  if (rootBase && rootBase !== apiBase) {
    targets.push({ endpoint: `${rootBase}/job-status/${encodedApiKey}/${encodedJobId}`, useBearer: false });
    targets.push({ endpoint: `${rootBase}/api/v1/job-status/${encodedApiKey}/${encodedJobId}`, useBearer: false });
  }
  return uniqueStatusTargets(targets);
}

async function getStatusCandidate(target: StatusTarget, apiKey: string): Promise<UpstreamResult> {
  const resp = await fetch(target.endpoint, {
    method: "GET",
    headers: target.useBearer ? { authorization: `Bearer ${apiKey}` } : undefined
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: resp.ok,
    status: resp.status,
    json,
    endpoint: target.endpoint
  };
}

function looksLikeProviderJobId(id: string): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
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

function tupleFromJobStatusRaw(
  raw: Record<string, unknown>,
  proofId: string,
  aggregationDomainId: string,
  intentHash?: string,
  nullifier?: string
): ProofAggregationTuple | null {
  const details = raw.aggregationDetails;
  if (!details || typeof details !== "object") return null;
  const row = details as Record<string, unknown>;

  const aggregationId = String(raw.aggregationId ?? row.aggregationId ?? "").trim();
  const leaf = String(row.leaf ?? raw.statement ?? "").trim();
  const leafCount = String(row.numberOfLeaves ?? row.leafCount ?? "").trim();
  const index = String(row.leafIndex ?? row.index ?? "").trim();
  const merklePath = Array.isArray(row.merkleProof)
    ? row.merkleProof.map((x) => String(x))
    : Array.isArray(row.merklePath)
      ? row.merklePath.map((x) => String(x))
      : [];

  if (!aggregationId || !leaf || !leafCount || !index) return null;
  return {
    proofId,
    aggregationDomainId,
    aggregationId,
    leafCount,
    index,
    leaf,
    merklePath,
    intentHash: intentHash && intentHash.trim() ? intentHash : undefined,
    nullifier: nullifier && nullifier.trim() ? nullifier : undefined
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProofAggregationTuple | ErrorResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const proofId = String(req.query.proofId ?? "").trim();
  if (!proofId) {
    return res.status(400).json({ error: "proofId is required" });
  }

  const queryProviderJobId = String(req.query.providerJobId ?? "").trim();
  const cachedStatus = getStatus(proofId);
  const providerJobId = String(
    cachedStatus?.providerJobId ?? (looksLikeProviderJobId(queryProviderJobId) ? queryProviderJobId : "")
  ).trim();

  let env: ReturnType<typeof getKurierEnv>;
  try {
    env = getKurierEnv();
  } catch (_error) {
    const cached = getTuple(proofId);
    if (cached) {
      return res.status(200).json(cached);
    }
    return res.status(500).json({ error: "kurier env missing or unreachable" });
  }

  if (!providerJobId) {
    const cached = getTuple(proofId);
    if (cached) return res.status(200).json(cached);
    return res.status(400).json({
      error: "providerJobId missing; query /api/proof-status first",
      source: "kurier-keyed"
    });
  }

  let statusUpstream: UpstreamResult | null = null;
  const attempts: Array<{
    status: number;
    endpoint: string;
    message: string;
    availableKeys: string[];
    rawPreview?: string;
  }> = [];
  for (const target of buildJobStatusTargets(env.apiUrl, env.apiKey, providerJobId)) {
    statusUpstream = await getStatusCandidate(target, env.apiKey);
    const raw = statusUpstream.json;
    if (statusUpstream.ok) break;
    attempts.push({
      status: statusUpstream.status,
      endpoint: statusUpstream.endpoint,
      message: String(raw.message ?? raw.error ?? "job status fetch failed"),
      availableKeys: Object.keys(raw),
      rawPreview: JSON.stringify(raw).slice(0, 300)
    });
  }

  if (!statusUpstream) {
    const cached = getTuple(proofId);
    if (cached) return res.status(200).json(cached);
    return res.status(500).json({ error: "aggregation tuple fetch failed: no request attempted", source: "kurier-keyed" });
  }
  const raw = statusUpstream.json;
  if (!statusUpstream.ok) {
    const details = attempts.map(
      (item) =>
        `status=${item.status} endpoint=${item.endpoint} message=${item.message}${item.rawPreview ? ` raw=${item.rawPreview}` : ""}`
    );
    return res.status(statusUpstream.status).json({
      error: "aggregation tuple fetch failed",
      details,
      availableKeys: Object.keys(raw),
      source: "kurier-keyed",
      attempts
    });
  }

  const tuple = tupleFromJobStatusRaw(
    raw,
    proofId,
    env.aggregationDomainId,
    cachedStatus?.intentHash,
    cachedStatus?.nullifier
  );
  if (!tuple) {
    const status = String(raw.status ?? "").toLowerCase();
    if (status && !status.includes("aggregated")) {
      return res.status(409).json({
        error: `aggregation not ready: ${String(raw.status)}`,
        availableKeys: Object.keys(raw),
        source: "kurier-keyed"
      });
    }
    return res.status(422).json({
      error: "job-status missing aggregationDetails tuple fields",
      availableKeys: Object.keys(raw),
      source: "kurier-keyed"
    });
  }

  const leafCount = parseUintLike(tuple.leafCount);
  const index = parseUintLike(tuple.index);

  if (
    !tuple.aggregationDomainId ||
    !tuple.aggregationId ||
    !tuple.leaf ||
    leafCount === null ||
    index === null ||
    (leafCount > 1n && tuple.merklePath.length === 0)
  ) {
    return res.status(422).json({
      error: "tuple missing required fields",
      availableKeys: Object.keys((raw.aggregationDetails as Record<string, unknown> | undefined) ?? raw),
      source: "kurier-keyed"
    });
  }

  upsertTuple(tuple);
  return res.status(200).json(tuple);
}
