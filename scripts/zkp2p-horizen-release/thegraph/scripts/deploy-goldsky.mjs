import { execSync } from "node:child_process";

const name = process.env.GOLDSKY_SUBGRAPH_NAME ?? "zkp2p-horizen-release";
const version = process.env.GOLDSKY_SUBGRAPH_VERSION ?? "v1";
const target = `${name}/${version}`;

console.log(`Deploying subgraph to Goldsky target: ${target}`);
execSync(`goldsky subgraph deploy ${target} --path .`, { stdio: "inherit" });
