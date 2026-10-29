// Creates .env for the LOCAL chain from .env.example using anvil's public dev keys.
// Refuses to overwrite an existing .env. Usage: pnpm env:local
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
const updates: Record<string, string> = { ...ANVIL_KEYS, CHAIN_ID: "31337" };
updates.ARBITER_ADDRESS = privateKeyToAccount(ANVIL_KEYS.ARBITER_PRIVATE_KEY).address;
updates.GATEWAY_ADDRESS = privateKeyToAccount(ANVIL_KEYS.GATEWAY_PRIVATE_KEY).address;
writeFileSync(envPath, upsertEnv(readFileSync(join(root, ".env.example"), "utf8"), updates));
console.log("wrote .env with anvil development keys (local use only)");
