import type { NextApiRequest, NextApiResponse } from "next";
import type { ProofStatusResponse } from "@/src/zk/zkp2p-horizen-release/schemas";
import { getStatus, upsertStatus } from "@/src/zk/zkp2p-horizen-release/store/proof-store";
import { getKurierEnv, mapProofStatus } from "@/src/zk/zkp2p-horizen-release/api/kurier";

type ErrorResponse = {
  error: string;
  details?: string[];
  availableKeys?: string[];
  source?: string;
  attempts?: Array<{ status: number; endpoint: string; message: string; availableKeys: string[]; rawPreview?: string }>;
};

type StatusTarget = {
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

function normalizeBaseUrl(urlText: string): string {
  return String(urlText).replace(/\/+$/, "");
}

function stripApiVersion(baseUrl: string): string {
  return baseUrl.replace(/\/api\/v\d+$/i, "");
}

function uniqueTargets(targets: StatusTarget[]): StatusTarget[] {
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

function buildStatusTargets(
  apiUrl: string,
  apiKey: string,
  _proofId: string,
  providerJobId?: string
): StatusTarget[] {
  const apiBase = normalizeBaseUrl(apiUrl);
  const rootBase = stripApiVersion(apiBase);
  const encodedApiKey = encodeURIComponent(apiKey);
  const encodedJobId = encodeURIComponent(String(providerJobId || "").trim());
  const targets: StatusTarget[] = [];
  if (encodedJobId) {
    targets.push({ endpoint: `${apiBase}/job-status/${encodedApiKey}/${encodedJobId}`, useBearer: false });
    targets.push({ endpoint: `${apiBase}/job-status/${encodedApiKey}/${encodedJobId}`, useBearer: true });
  }
  if (rootBase && rootBase !== apiBase) {
    if (encodedJobId) {
      targets.push({ endpoint: `${rootBase}/job-status/${encodedApiKey}/${encodedJobId}`, useBearer: false });
      targets.push({ endpoint: `${rootBase}/api/v1/job-status/${encodedApiKey}/${encodedJobId}`, useBearer: false });
    }
  }
  return uniqueTargets(targets);
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

function extractRawStatus(raw: Record<string, unknown>): string {
  const direct =
    raw.status ??
    raw.rawStatus ??
    raw.proofStatus ??
    raw.verificationStatus ??
    raw.state;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const nestedCandidates = [raw.proof, raw.result, raw.data, raw.payload];
  for (const nested of nestedCandidates) {
    if (!nested || typeof nested !== "object") continue;
    const row = nested as Record<string, unknown>;
    const nestedStatus = row.status ?? row.rawStatus ?? row.proofStatus ?? row.verificationStatus ?? row.state;
    if (typeof nestedStatus === "string" && nestedStatus.trim()) {
      return nestedStatus.trim();
    }
  }

  return "pending";
}

function extractProviderJobId(raw: Record<string, unknown>): string {
  const deep = findProviderJobIdDeep(raw);
  if (deep) return deep;
  const rawText = JSON.stringify(raw);
  const uuid = rawText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return uuid?.[0] || "";
}

function extractErrorDetails(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      out.push(value.trim());
      return;
    }
    if (value && typeof value === "object") {
      const text = JSON.stringify(value);
      if (text && text !== "{}") out.push(text);
    }
  };

  const collectCommonDetailKeys = (obj: Record<string, unknown>) => {
    const direct = obj.errorDetails;
    if (Array.isArray(direct)) {
      for (const item of direct) push(item);
    } else if (direct != null) {
      push(direct);
    }

    for (const key of ["details", "errors", "reasons", "causes", "violations"]) {
      const val = obj[key];
      if (Array.isArray(val)) {
        for (const item of val) push(item);
      } else if (val != null) {
        push(val);
      }
    }
  };

  collectCommonDetailKeys(raw);

  for (const key of ["details", "errors"]) {
    const val = raw[key];
    if (Array.isArray(val)) {
      for (const item of val) push(item);
    } else if (val != null) {
      push(val);
    }
  }

  const nestedCandidates = [raw.data, raw.result, raw.payload, raw.job, raw.proof];
  for (const nested of nestedCandidates) {
    if (!nested || typeof nested !== "object") continue;
    const row = nested as Record<string, unknown>;
    collectCommonDetailKeys(row);
    if (row.error && typeof row.error === "object") {
      collectCommonDetailKeys(row.error as Record<string, unknown>);
    }
  }

  if (out.length === 0) {
    const fallback = JSON.stringify(raw).slice(0, 500);
    if (fallback && fallback !== "{}") out.push(`raw=${fallback}`);
  }

  return Array.from(new Set(out)).slice(0, 8);
}

function extractErrorMessage(raw: Record<string, unknown>): string {
  const direct = [raw.error, raw.message, raw.reason];
  for (const item of direct) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const nested = item as Record<string, unknown>;
      for (const key of ["message", "error", "reason", "title"]) {
        const text = nested[key];
        if (typeof text === "string" && text.trim()) return text.trim();
      }
    }
  }
  const details = extractErrorDetails(raw);
  return details[0] || "";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProofStatusResponse | ErrorResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const proofId = String(req.query.proofId ?? "").trim();
  if (!proofId) {
    return res.status(400).json({ error: "proofId is required" });
  }
  const queryProviderJobId = String(req.query.providerJobId ?? "").trim();
  const cached = getStatus(proofId);
  const providerJobIdFromProofId = looksLikeProviderJobId(proofId) ? proofId : "";
  const providerJobId = String(
    cached?.providerJobId ??
      (looksLikeProviderJobId(queryProviderJobId) ? queryProviderJobId : "") ??
      providerJobIdFromProofId
  ).trim();

  let env: ReturnType<typeof getKurierEnv>;
  try {
    env = getKurierEnv();
  } catch (_error) {
    const cached = getStatus(proofId);
    if (cached) {
      return res.status(200).json(cached);
    }
    return res.status(500).json({ error: "kurier env missing or unreachable" });
  }

  if (!providerJobId) {
    if (cached) {
      return res.status(200).json(cached);
    }
    return res.status(400).json({
      error: "providerJobId missing; pass ?providerJobId=<kurier-job-uuid> or resubmit proof"
    });
  }

  let upstream: UpstreamResult | null = null;
  const attempts: Array<{
    status: number;
    endpoint: string;
    message: string;
    availableKeys: string[];
    rawPreview?: string;
  }> = [];
  for (const target of buildStatusTargets(env.apiUrl, env.apiKey, proofId, providerJobId || undefined)) {
    upstream = await getStatusCandidate(target, env.apiKey);
    const raw = upstream.json;
    if (upstream.ok) break;
    attempts.push({
      status: upstream.status,
      endpoint: upstream.endpoint,
      message: String(raw.message ?? raw.error ?? "status failed"),
      availableKeys: Object.keys(raw),
      rawPreview: JSON.stringify(raw).slice(0, 300)
    });
    // Keep probing only if route mismatch.
    if (upstream.status !== 404) break;
  }

  if (!upstream) {
    const cached = getStatus(proofId);
    if (cached) return res.status(200).json(cached);
    return res.status(500).json({ error: "kurier status failed: no request attempted" });
  }
  const raw = upstream.json;

  if (!upstream.ok) {
    if (cached && (cached.status === "verified" || cached.status === "aggregated")) {
      const optimistic: ProofStatusResponse = {
        ...cached,
        status: cached.status || "pending",
        rawStatus: cached.rawStatus || "pending",
        updatedAt: new Date().toISOString(),
        source: cached.source || "kurier-keyed",
        availableKeys: cached.availableKeys || []
      };
      upsertStatus(optimistic);
      return res.status(200).json(optimistic);
    }
    const details = attempts.map(
      (item) =>
        `status=${item.status} endpoint=${item.endpoint} message=${item.message}${item.rawPreview ? ` raw=${item.rawPreview}` : ""}`
    );
    if (!providerJobId) {
      details.push("providerJobId missing in cached submit response; cannot query Kurier job endpoints");
    }
    return res.status(upstream.status).json({
      error: "kurier status failed",
      details,
      availableKeys: Object.keys(raw),
      source: "kurier-keyed",
      attempts
    });
  }

  const rawStatus = extractRawStatus(raw);

  const mapped: ProofStatusResponse = {
    proofId,
    status: mapProofStatus(rawStatus),
    rawStatus,
    updatedAt: new Date().toISOString(),
    source: "kurier-keyed",
    availableKeys: Object.keys(raw),
    providerJobId: extractProviderJobId(raw) || providerJobId || cached?.providerJobId,
    intentHash: cached?.intentHash,
    nullifier: cached?.nullifier
  };
  if (mapped.status === "failed") {
    const error = extractErrorMessage(raw);
    const details = extractErrorDetails(raw);
    if (error) mapped.error = error;
    if (details.length > 0) mapped.details = details;
  }

  upsertStatus(mapped);
  return res.status(200).json(mapped);
}
