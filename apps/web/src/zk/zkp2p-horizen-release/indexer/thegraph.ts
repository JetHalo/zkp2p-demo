import { Contract, JsonRpcProvider, formatUnits, isAddress } from "ethers";

export interface CommitmentRow {
  id: number;
  intentId: string;
  buyer: string;
  amount: string;
  txHash: string;
  blockNumber: number;
  createdAt: string;
}

type GraphCommitment = {
  intentId: string;
  buyer: string;
  amount: string;
  txHash: string;
  blockNumber: string;
  createdAt: string;
};

type GraphDepositEvent = {
  seller: string;
  amount: string;
  txHash: string;
  blockNumber: string;
  createdAt: string;
};

export interface SellerLiquidityRow {
  sellerAddress: string;
  depositedUsdc: number;
  reservedUsdc: number;
  availableUsdc: number;
  eventDepositedUsdc: number;
  lastDepositTxHash: string;
  lastDepositBlock: number;
  lastDepositAt: string;
}

const poolReadAbi = [
  "function sellerDeposits(address) view returns (uint256)",
  "function sellerReserved(address) view returns (uint256)"
];

function normalizeSellerAddresses(sellerAddresses: string[]): string[] {
  const set = new Set<string>();
  for (const seller of sellerAddresses) {
    if (!isAddress(seller)) continue;
    set.add(seller.toLowerCase());
  }
  return Array.from(set.values());
}

export async function readRecentCommitmentsFromTheGraph(
  subgraphUrl: string,
  limit: number
): Promise<CommitmentRow[]> {
  const query = `
    query Commitments($limit: Int!) {
      commitments(first: $limit, orderBy: blockNumber, orderDirection: desc) {
        intentId
        buyer
        amount
        txHash
        blockNumber
        createdAt
      }
    }
  `;

  const resp = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { limit } })
  });

  if (!resp.ok) {
    throw new Error(`subgraph request failed: ${resp.status}`);
  }

  const json = (await resp.json()) as {
    data?: { commitments?: GraphCommitment[] };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const rows = json.data?.commitments ?? [];

  return rows.map((row, index) => ({
    id: index + 1,
    intentId: row.intentId,
    buyer: row.buyer,
    amount: row.amount,
    txHash: row.txHash,
    blockNumber: Number(row.blockNumber),
    createdAt: row.createdAt
  }));
}

export async function readSellerLiquidityFromTheGraph(
  subgraphUrl: string,
  contractAddress: string,
  rpcUrl: string,
  limit: number
): Promise<SellerLiquidityRow[]> {
  const query = `
    query SellerDepositEvents($limit: Int!) {
      depositEvents(first: $limit, orderBy: blockNumber, orderDirection: desc) {
        seller
        amount
        txHash
        blockNumber
        createdAt
      }
    }
  `;

  const resp = await fetch(subgraphUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { limit } })
  });

  if (!resp.ok) {
    throw new Error(`subgraph request failed: ${resp.status}`);
  }

  const json = (await resp.json()) as {
    data?: { depositEvents?: GraphDepositEvent[] };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  const events = json.data?.depositEvents ?? [];
  const bySeller = new Map<
    string,
    {
      eventDepositedRaw: bigint;
      lastDepositTxHash: string;
      lastDepositBlock: number;
      lastDepositAt: string;
    }
  >();

  for (const event of events) {
    const sellerAddress = event.seller;
    const normalizedSeller = sellerAddress.toLowerCase();
    const amountRaw = BigInt(event.amount);
    const blockNumber = Number(event.blockNumber);

    const current = bySeller.get(normalizedSeller);
    if (!current) {
      bySeller.set(normalizedSeller, {
        eventDepositedRaw: amountRaw,
        lastDepositTxHash: event.txHash,
        lastDepositBlock: blockNumber,
        lastDepositAt: event.createdAt
      });
      continue;
    }

    current.eventDepositedRaw += amountRaw;
    if (blockNumber > current.lastDepositBlock) {
      current.lastDepositBlock = blockNumber;
      current.lastDepositTxHash = event.txHash;
      current.lastDepositAt = event.createdAt;
    }
  }

  if (bySeller.size === 0) return [];

  const baseRows = Array.from(bySeller.entries()).map(([sellerAddress, data]) => {
    const eventDepositedUsdc = Number(formatUnits(data.eventDepositedRaw, 6));
    return {
      sellerAddress,
      depositedUsdc: eventDepositedUsdc,
      reservedUsdc: 0,
      availableUsdc: eventDepositedUsdc,
      eventDepositedUsdc,
      lastDepositTxHash: data.lastDepositTxHash,
      lastDepositBlock: data.lastDepositBlock,
      lastDepositAt: data.lastDepositAt
    } satisfies SellerLiquidityRow;
  });

  if (!isAddress(contractAddress)) {
    return baseRows.sort((a, b) => {
      if (b.availableUsdc !== a.availableUsdc) return b.availableUsdc - a.availableUsdc;
      return b.lastDepositBlock - a.lastDepositBlock;
    });
  }

  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const pool = new Contract(contractAddress, poolReadAbi, provider);

    const rows = await Promise.all(
      baseRows.map(async (baseRow) => {
        try {
          const [depositedRaw, reservedRaw] = await Promise.all([
            pool.sellerDeposits(baseRow.sellerAddress) as Promise<bigint>,
            pool.sellerReserved(baseRow.sellerAddress) as Promise<bigint>
          ]);

          const availableRaw = depositedRaw - reservedRaw;
          return {
            ...baseRow,
            depositedUsdc: Number(formatUnits(depositedRaw, 6)),
            reservedUsdc: Number(formatUnits(reservedRaw, 6)),
            availableUsdc: Number(formatUnits(availableRaw, 6))
          } satisfies SellerLiquidityRow;
        } catch {
          return baseRow;
        }
      })
    );

    return rows.sort((a, b) => {
      if (b.availableUsdc !== a.availableUsdc) return b.availableUsdc - a.availableUsdc;
      return b.lastDepositBlock - a.lastDepositBlock;
    });
  } catch {
    return baseRows.sort((a, b) => {
      if (b.availableUsdc !== a.availableUsdc) return b.availableUsdc - a.availableUsdc;
      return b.lastDepositBlock - a.lastDepositBlock;
    });
  }
}

export async function readSellerLiquidityFromContractAddresses(
  contractAddress: string,
  rpcUrl: string,
  sellerAddresses: string[]
): Promise<SellerLiquidityRow[]> {
  if (!isAddress(contractAddress)) {
    throw new Error("invalid contract address for seller liquidity query");
  }

  const normalizedSellers = normalizeSellerAddresses(sellerAddresses);
  if (normalizedSellers.length === 0) return [];

  const provider = new JsonRpcProvider(rpcUrl);
  const pool = new Contract(contractAddress, poolReadAbi, provider);

  const rows = await Promise.all(
    normalizedSellers.map(async (sellerAddress) => {
      const [depositedRaw, reservedRaw] = await Promise.all([
        pool.sellerDeposits(sellerAddress) as Promise<bigint>,
        pool.sellerReserved(sellerAddress) as Promise<bigint>
      ]);

      const availableRaw = depositedRaw - reservedRaw;
      return {
        sellerAddress,
        depositedUsdc: Number(formatUnits(depositedRaw, 6)),
        reservedUsdc: Number(formatUnits(reservedRaw, 6)),
        availableUsdc: Number(formatUnits(availableRaw, 6)),
        eventDepositedUsdc: Number(formatUnits(depositedRaw, 6)),
        lastDepositTxHash: "0x",
        lastDepositBlock: 0,
        lastDepositAt: ""
      } satisfies SellerLiquidityRow;
    })
  );

  return rows
    .filter((row) => row.depositedUsdc > 0 || row.reservedUsdc > 0)
    .sort((a, b) => {
      if (b.availableUsdc !== a.availableUsdc) return b.availableUsdc - a.availableUsdc;
      return b.depositedUsdc - a.depositedUsdc;
    });
}
