import type { NextApiRequest, NextApiResponse } from "next";
import { readRecentCommitments } from "@/src/zk/zkp2p-horizen-release/indexer/sqlite";
import { readRecentCommitmentsFromTheGraph } from "@/src/zk/zkp2p-horizen-release/indexer/thegraph";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const limit = Number(req.query.limit ?? 20);
  const safeLimit = Number.isFinite(limit) ? limit : 20;
  const subgraphUrl = process.env.THEGRAPH_SUBGRAPH_URL;

  if (subgraphUrl) {
    try {
      const rows = await readRecentCommitmentsFromTheGraph(subgraphUrl, safeLimit);
      return res.status(200).json({ rows, strategy: "thegraph", fallbackUsed: false });
    } catch (_error) {
      const fallbackRows = await readRecentCommitments(safeLimit);
      return res.status(200).json({ rows: fallbackRows, strategy: "thegraph", fallbackUsed: true });
    }
  }

  const rows = await readRecentCommitments(safeLimit);
  return res.status(200).json({ rows, strategy: "thegraph", fallbackUsed: true });
}
