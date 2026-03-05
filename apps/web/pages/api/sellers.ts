import type { NextApiRequest, NextApiResponse } from "next";
import { isAddress } from "ethers";
import { readSellerLiquidityFromTheGraph } from "@/src/zk/zkp2p-horizen-release/indexer/thegraph";
import { readSellerProfiles } from "@/src/zk/zkp2p-horizen-release/seller-profile-store";

const defaultHorizenRpcUrl = "https://horizen-testnet.rpc.caldera.xyz/http";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const subgraphUrl = process.env.THEGRAPH_SUBGRAPH_URL;
  if (!subgraphUrl) {
    return res.status(500).json({ error: "THEGRAPH_SUBGRAPH_URL is not configured" });
  }

  const contractAddress =
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? process.env.NEXT_PUBLIC_DEPOSIT_POOL_ADDRESS ?? "";
  if (!isAddress(contractAddress)) {
    return res.status(500).json({ error: "NEXT_PUBLIC_CONTRACT_ADDRESS is not configured or invalid" });
  }

  const rpcUrl = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? defaultHorizenRpcUrl;
  const limit = Number(req.query.limit ?? 400);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 2000) : 400;

  try {
    const [rows, profiles] = await Promise.all([
      readSellerLiquidityFromTheGraph(subgraphUrl, contractAddress, rpcUrl, safeLimit),
      readSellerProfiles()
    ]);

    return res.status(200).json({
      rows,
      profiles,
      strategy: "thegraph-primary-contract-fallback",
      contractAddress,
      rpcUrlUsed: rpcUrl
    });
  } catch (error) {
    return res.status(500).json({
      error: "failed to load seller liquidity",
      detail: (error as Error).message
    });
  }
}
