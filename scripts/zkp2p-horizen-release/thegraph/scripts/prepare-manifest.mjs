import fs from "node:fs";
import path from "node:path";

const manifestPath = path.resolve("subgraph.yaml");
const network = process.env.SUBGRAPH_NETWORK ?? "horizen-testnet";
const address = process.env.DEPOSIT_POOL_ADDRESS;
const startBlock = process.env.DEPOSIT_POOL_START_BLOCK ?? process.env.START_BLOCK;

if (!fs.existsSync(manifestPath)) {
  throw new Error(`subgraph manifest not found: ${manifestPath}`);
}

if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
  throw new Error("DEPOSIT_POOL_ADDRESS is required and must be a valid EVM address");
}

if (!startBlock || !/^\d+$/.test(startBlock)) {
  throw new Error("DEPOSIT_POOL_START_BLOCK (or START_BLOCK) is required and must be an integer");
}

const source = fs.readFileSync(manifestPath, "utf8");

let output = source;
output = output.replace(/^(\s*network:\s*).+$/m, `$1${network}`);
output = output.replace(/^(\s*address:\s*).+$/m, `$1"${address}"`);
output = output.replace(/^(\s*startBlock:\s*).+$/m, `$1${startBlock}`);

fs.writeFileSync(manifestPath, output, "utf8");

console.log("Prepared subgraph.yaml with:");
console.log(`- network: ${network}`);
console.log(`- address: ${address}`);
console.log(`- startBlock: ${startBlock}`);
