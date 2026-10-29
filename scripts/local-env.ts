// Creates .env for the LOCAL chain from .env.example using anvil's public dev keys.
// Refuses to overwrite an existing .env. Usage: pnpm env:local
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { upsertEnv } from "./lib/env.js";
import { ANVIL_KEYS } from "./lib/keys.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  console.error(".env already exists; not overwriting");
  process.exit(1);
}
const updates: Record<string, string> = {
  ...ANVIL_KEYS,
  CHAIN_ID: "31337",
  // demo timings (docs/05): 30s dispute window, short batches, quick reason wait
  DISPUTE_WINDOW_SECONDS: "30",
  BATCH_MAX_SECONDS: "10",
  REASON_WAIT_SECONDS: "3",
  // random per machine: gates the API's privileged routes
  API_ADMIN_TOKEN: randomBytes(24).toString("hex"),
};
updates.ARBITER_ADDRESS = privateKeyToAccount(ANVIL_KEYS.ARBITER_PRIVATE_KEY).address;
updates.GATEWAY_ADDRESS = privateKeyToAccount(ANVIL_KEYS.GATEWAY_PRIVATE_KEY).address;
// prefill for the dashboard mandate form (public addresses, no keys)
updates.VITE_AGENT_ADDRESS = privateKeyToAccount(ANVIL_KEYS.AGENT_PRIVATE_KEY).address;
updates.VITE_MERCHANT_ADDRESS = privateKeyToAccount(ANVIL_KEYS.MERCHANT_PRIVATE_KEY).address;
writeFileSync(envPath, upsertEnv(readFileSync(join(root, ".env.example"), "utf8"), updates));
console.log("wrote .env with anvil development keys (local use only)");
