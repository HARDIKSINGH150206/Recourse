// pnpm db:reset (dev only): deletes the SQLite files in DB_DIR; services re-create them via migrations.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
const dir = assertInsideRepo(root, env.DB_DIR ?? "./data");

let removed = 0;
if (existsSync(dir)) {
  for (const f of readdirSync(dir)) {
    if (/\.db(-wal|-shm)?$/.test(f)) {
      rmSync(join(dir, f));
      removed++;
    }
  }
}
console.log(`removed ${removed} database file(s) from ${dir}`);
