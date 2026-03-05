export interface DiagnosticError {
  error: string;
  source: "kurier-keyed" | "kurier-public";
  availableKeys: string[];
  statusCode?: number;
}

export type KurierProofVariant = "Plain" | "ZK";

export function getKurierEnv(): {
  apiUrl: string;
  apiKey: string;
  appId: string;
  aggregationDomainId: string;
} {
  const apiUrl = process.env.KURIER_API_URL;
  const apiKey = process.env.KURIER_API_KEY;
  // appId is an application namespace bound into statement/public inputs.
  // It does not have to be surfaced as a dedicated field in Kurier UI.
  const appId = process.env.KURIER_API_ID ?? process.env.KURIER_APP_ID ?? "zkp2p";
  const aggregationDomainId = process.env.KURIER_AGGREGATION_DOMAIN_ID;

  if (!apiUrl || !apiKey || !aggregationDomainId) {
    throw new Error(
      "missing KURIER env: KURIER_API_URL/KURIER_API_KEY/KURIER_AGGREGATION_DOMAIN_ID"
    );
  }

  return {
    apiUrl,
    apiKey,
    appId: String(appId).trim(),
    aggregationDomainId: String(aggregationDomainId).trim()
  };
}

export function getKurierSubmitEnv(): {
  apiUrl: string;
  apiKey: string;
  appId: string;
  aggregationDomainId: string;
  vkHash: string;
  proofVariant: KurierProofVariant;
} {
  const base = getKurierEnv();
  const vkHash = String(process.env.KURIER_VK_HASH ?? "").trim();
  const rawVariant = String(process.env.KURIER_PROOF_VARIANT ?? "Plain").trim();

  if (!vkHash) {
    throw new Error("missing KURIER env: KURIER_VK_HASH");
  }

  let proofVariant: KurierProofVariant;
  if (/^plain$/i.test(rawVariant)) {
    proofVariant = "Plain";
  } else if (/^zk$/i.test(rawVariant)) {
    proofVariant = "ZK";
  } else {
    throw new Error('invalid KURIER_PROOF_VARIANT: expected "Plain" or "ZK"');
  }

  return {
    ...base,
    vkHash,
    proofVariant
  };
}

export async function kurierGet(path: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const { apiUrl, apiKey } = getKurierEnv();
  const resp = await fetch(`${apiUrl}${path}`, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: resp.ok, status: resp.status, json };
}

export async function kurierPost(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const { apiUrl, apiKey } = getKurierEnv();
  const resp = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: resp.ok, status: resp.status, json };
}

export function mapProofStatus(rawStatus: string): "pending" | "verified" | "aggregated" | "failed" {
  const s = rawStatus.toLowerCase();
  if (s.includes("fail") || s.includes("error") || s.includes("reject") || s.includes("invalid")) {
    return "failed";
  }
  if (s.includes("aggregated") || s.includes("aggregationpublished") || s.includes("published")) {
    return "aggregated";
  }
  if (
    s.includes("verified") ||
    s.includes("included") ||
    s.includes("finalized") ||
    s.includes("aggregation pending") ||
    s.includes("aggregationpending")
  ) {
    return "verified";
  }
  return "pending";
}
