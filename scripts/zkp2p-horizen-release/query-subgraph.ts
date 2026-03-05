/* eslint-disable no-console */

async function main(): Promise<void> {
  const endpoint = process.env.THEGRAPH_SUBGRAPH_URL;
  if (!endpoint) {
    throw new Error("THEGRAPH_SUBGRAPH_URL is required");
  }

  const limit = Number(process.argv[2] ?? "20");
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

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { limit } })
  });

  const json = await resp.json();
  console.log(JSON.stringify(json, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
