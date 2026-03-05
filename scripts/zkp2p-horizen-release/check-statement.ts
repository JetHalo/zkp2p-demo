import {
  buildStatement,
  buildStatementField,
  type StatementInput
} from "../../apps/web/src/zk/zkp2p-horizen-release/statement.ts";

function main(): void {
  const sample: StatementInput = {
    intentId: "0x1111111111111111111111111111111111111111111111111111111111111111",
    buyerAddress: "0x000000000000000000000000000000000000b0b0",
    amount: 100_000_000n,
    chainId: 7332n,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    businessDomain: "zkp2p-horizen",
    appId: "zkp2p"
  };

  const statement = buildStatement(sample);
  const statementField = buildStatementField(sample).toString();
  const leaf = process.env.LEAF?.toLowerCase();
  const statementEqLeaf = leaf ? leaf === statement.toLowerCase() : null;
  const serializedSample = {
    ...sample,
    amount: sample.amount.toString(),
    chainId: sample.chainId.toString(),
    timestamp: sample.timestamp.toString()
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ statement, statementField, statementEqLeaf, sample: serializedSample }, null, 2));
}

main();
