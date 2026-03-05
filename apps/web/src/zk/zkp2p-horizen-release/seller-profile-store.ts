import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type SellerProfile = {
  sellerAddress: string;
  wiseTag: string;
  wiseQrDataUrl: string;
  wiseQrFileName: string;
  updatedAt: string;
};

function resolveStorePath(): string {
  const explicit = process.env.SELLER_PROFILE_STORE_PATH;
  if (explicit && explicit.trim()) return explicit.trim();

  const cwd = process.cwd();
  const monorepoWebPath = path.join(cwd, "apps", "web");
  if (existsSync(monorepoWebPath)) {
    return path.join(monorepoWebPath, ".data", "seller-profiles.json");
  }

  return path.join(cwd, ".data", "seller-profiles.json");
}

const STORE_PATH = resolveStorePath();

function normalizeSellerAddress(value: string): string {
  return value.trim().toLowerCase();
}

async function readRawProfiles(): Promise<Record<string, SellerProfile>> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, SellerProfile>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

async function writeRawProfiles(profiles: Record<string, SellerProfile>): Promise<void> {
  const dir = path.dirname(STORE_PATH);
  await mkdir(dir, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(profiles, null, 2), "utf8");
}

export async function readSellerProfiles(): Promise<Record<string, SellerProfile>> {
  const raw = await readRawProfiles();
  const next: Record<string, SellerProfile> = {};

  for (const profile of Object.values(raw)) {
    if (!profile || typeof profile !== "object") continue;
    const sellerAddress = normalizeSellerAddress(profile.sellerAddress ?? "");
    if (!sellerAddress) continue;
    next[sellerAddress] = {
      sellerAddress,
      wiseTag: String(profile.wiseTag ?? "").replace(/^@+/, "").trim(),
      wiseQrDataUrl: String(profile.wiseQrDataUrl ?? "").trim(),
      wiseQrFileName: String(profile.wiseQrFileName ?? "wise-qr").trim() || "wise-qr",
      updatedAt: String(profile.updatedAt ?? new Date().toISOString())
    };
  }

  return next;
}

export async function upsertSellerProfile(input: {
  sellerAddress: string;
  wiseTag: string;
  wiseQrDataUrl: string;
  wiseQrFileName?: string;
}): Promise<SellerProfile> {
  const sellerAddress = normalizeSellerAddress(input.sellerAddress);
  if (!sellerAddress) {
    throw new Error("sellerAddress is required");
  }

  const wiseTag = String(input.wiseTag ?? "").replace(/^@+/, "").trim();
  const wiseQrDataUrl = String(input.wiseQrDataUrl ?? "").trim();
  const wiseQrFileName = String(input.wiseQrFileName ?? "wise-qr").trim() || "wise-qr";

  if (!wiseTag) throw new Error("wiseTag is required");
  if (!wiseQrDataUrl) throw new Error("wiseQrDataUrl is required");

  const profiles = await readRawProfiles();
  const profile: SellerProfile = {
    sellerAddress,
    wiseTag,
    wiseQrDataUrl,
    wiseQrFileName,
    updatedAt: new Date().toISOString()
  };
  profiles[sellerAddress] = profile;
  await writeRawProfiles(profiles);
  return profile;
}
