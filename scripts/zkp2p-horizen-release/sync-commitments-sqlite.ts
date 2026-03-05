/* eslint-disable no-console */
import { execSync } from "node:child_process";

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function main(): void {
  const from = Number(arg("--from", "0"));
  const chunk = Number(arg("--chunk", "2000"));
  const dbPath = arg("--db", "./indexer.db");

  console.log(`sync start from=${from} chunk=${chunk} db=${dbPath}`);
  console.log("TODO: replace with real RPC scan for Horizen events (Deposited/IntentReserved/Released/Withdrawn)");

  const initSql = [
    "CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK (id=1), last_synced_block INTEGER NOT NULL);",
    "INSERT OR IGNORE INTO sync_state(id, last_synced_block) VALUES (1, 0);",
    "CREATE TABLE IF NOT EXISTS commitments (",
    "id INTEGER PRIMARY KEY AUTOINCREMENT,",
    "intent_id TEXT NOT NULL,",
    "buyer TEXT NOT NULL,",
    "amount TEXT NOT NULL,",
    "tx_hash TEXT NOT NULL,",
    "block_number INTEGER NOT NULL,",
    "created_at TEXT NOT NULL",
    ");"
  ].join(" ");

  execSync(`sqlite3 ${dbPath} \"${initSql}\"`, { stdio: "inherit" });
  console.log("sqlite schema ready");
}

main();
