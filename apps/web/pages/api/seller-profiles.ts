import type { NextApiRequest, NextApiResponse } from "next";
import { isAddress } from "ethers";
import {
  readSellerProfiles,
  upsertSellerProfile
} from "@/src/zk/zkp2p-horizen-release/seller-profile-store";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const profiles = await readSellerProfiles();
    return res.status(200).json({ profiles });
  }

  if (req.method === "POST") {
    const sellerAddress = String(req.body?.sellerAddress ?? "");
    const wiseTag = String(req.body?.wiseTag ?? "");
    const wiseQrDataUrl = String(req.body?.wiseQrDataUrl ?? "");
    const wiseQrFileName = String(req.body?.wiseQrFileName ?? "wise-qr");

    if (!isAddress(sellerAddress)) {
      return res.status(400).json({ error: "invalid sellerAddress" });
    }
    if (!wiseTag.trim()) {
      return res.status(400).json({ error: "wiseTag is required" });
    }
    if (!wiseQrDataUrl.trim()) {
      return res.status(400).json({ error: "wiseQrDataUrl is required" });
    }

    try {
      const profile = await upsertSellerProfile({
        sellerAddress,
        wiseTag,
        wiseQrDataUrl,
        wiseQrFileName
      });
      return res.status(200).json({ profile });
    } catch (error) {
      return res.status(500).json({
        error: "failed to save seller profile",
        detail: (error as Error).message
      });
    }
  }

  return res.status(405).json({ error: "method not allowed" });
}
