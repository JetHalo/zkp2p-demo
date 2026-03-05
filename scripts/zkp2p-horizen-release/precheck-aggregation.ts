/* eslint-disable no-console */

type PrecheckInput = {
  statement: string;
  leaf: string;
  gatewayResult: boolean;
};

function main(): void {
  const input: PrecheckInput = {
    statement: process.env.STATEMENT ?? "",
    leaf: process.env.LEAF ?? "",
    gatewayResult: process.env.GATEWAY_OK === "true"
  };

  const statementEqLeaf = input.statement.length > 0 && input.statement.toLowerCase() === input.leaf.toLowerCase();
  const ok = statementEqLeaf && input.gatewayResult;

  console.log(
    JSON.stringify(
      {
        statementEqLeaf,
        gatewayResult: input.gatewayResult,
        precheckOk: ok
      },
      null,
      2
    )
  );

  process.exit(ok ? 0 : 1);
}

main();
