// Wipes ./data (DB_DIR) and reseeds the local chain. Usage: pnpm demo:reset
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "./lib/env.js";
import { assertInsideRepo } from "./lib/safety.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const env = {
  ...(existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {}),
  ...process.env,
};
const dataDir = assertInsideRepo(root, env.DB_DIR ?? "./data");

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
console.log(`cleared ${dataDir}`);

const r = spawnSync("pnpm", ["seed"], { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
