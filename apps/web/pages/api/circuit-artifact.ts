import fs from "node:fs/promises";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";

type ErrorResponse = {
  error: string;
  details?: string;
};

const ALLOWED_CIRCUITS: Record<string, string> = {
  zkp2p_horizen_release: path.resolve(
    process.cwd(),
    "../../circuits/zkp2p-horizen-release/noir/target/zkp2p_horizen_release.json"
  )
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Record<string, unknown> | ErrorResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const name = String(req.query.name ?? "zkp2p_horizen_release").trim();
  const filePath = ALLOWED_CIRCUITS[name];
  if (!filePath) {
    return res.status(400).json({ error: "unsupported circuit artifact name" });
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({
      error: "failed to load circuit artifact",
      details: (error as Error).message
    });
  }
}
