// Sends a benchmark summary to the API so the dashboard's Bench page can show it.
// Usage: pnpm bench:ingest bench/results/<run>/summary.json   (needs API_ADMIN_TOKEN and a running API)
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@recourse/shared";
import { parseEnv } from "./lib/env.js";

const MAX_BYTES = 900_000; // below the API's 1 MB body limit

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
const cfg = loadConfig({ ...fileEnv, ...process.env });

const file = process.argv[2];
if (!file) {
  console.error("usage: pnpm bench:ingest <path to summary.json>");
  process.exit(2);
}
if (!cfg.API_ADMIN_TOKEN) {
  console.error("API_ADMIN_TOKEN is not set in .env");
  process.exit(2);
}
if (statSync(file).size > MAX_BYTES) {
  console.error(`${file} is larger than ${MAX_BYTES} bytes; refusing to send it`);
  process.exit(2);
}

const res = await fetch(`${cfg.API_URL}/bench/runs`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${cfg.API_ADMIN_TOKEN}` },
  body: readFileSync(file, "utf8"),
});
const text = await res.text();
if (!res.ok) {
  console.error(`ingest failed (${res.status}): ${text}`);
  process.exit(1);
}
console.log(`${res.status === 201 ? "stored" : "already stored"}: ${text}`);
