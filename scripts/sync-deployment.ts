// Reads forge's broadcast output and writes deployments/<chainId>.json, then updates .env.
// Usage: pnpm sync:deployment   (CHAIN_ID from .env or env; default 31337)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { parseBroadcast } from "./lib/broadcast.js";
import { parseEnv, upsertEnv } from "./lib/env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const envText = existsSync(envPath)
  ? readFileSync(envPath, "utf8")
  : readFileSync(join(root, ".env.example"), "utf8");
const env = { ...parseEnv(envText), ...(process.env as Record<string, string>) };
const chainId = Number(env.CHAIN_ID ?? 31337);

const broadcastPath = join(
  root,
  "contracts/broadcast/Deploy.s.sol",
  String(chainId),
  "run-latest.json",
);
if (!existsSync(broadcastPath)) {
  console.error(`no broadcast file at ${broadcastPath}; run pnpm chain:deploy first`);
  process.exit(1);
}
const deployed = parseBroadcast(JSON.parse(readFileSync(broadcastPath, "utf8")));
const token = deployed.token ?? env.TOKEN_ADDRESS?.toLowerCase();
if (!token) {
  console.error("no MockUSDC deployed and TOKEN_ADDRESS is not set");
  process.exit(1);
}

const addr = (k: string) =>
  env[k] ? privateKeyToAccount(env[k] as `0x${string}`).address.toLowerCase() : null;
const record = {
  chainId,
  escrow: deployed.escrow,
  token,
  gateway: addr("GATEWAY_PRIVATE_KEY"),
  arbiter: addr("ARBITER_PRIVATE_KEY"),
  deployedAt: Math.floor(Date.now() / 1000),
};
mkdirSync(join(root, "deployments"), { recursive: true });
writeFileSync(join(root, "deployments", `${chainId}.json`), JSON.stringify(record, null, 2) + "\n");

writeFileSync(
  envPath,
  upsertEnv(envText, {
    ESCROW_ADDRESS: deployed.escrow,
    TOKEN_ADDRESS: token,
    VITE_ESCROW_ADDRESS: deployed.escrow,
    VITE_TOKEN_ADDRESS: token,
  }),
);
console.log(`wrote deployments/${chainId}.json and updated .env`);
