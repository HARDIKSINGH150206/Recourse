import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export type ApiDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Open the API database. `migrations: "apply"` (dev, demo, tests) runs pending migrations;
 * `"check"` refuses to start while migrations are pending (GUIDE.md section 6.3).
 */
export function openDatabase(path: string, opts: { migrations?: "apply" | "check" } = {}): ApiDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  if ((opts.migrations ?? "apply") === "apply") {
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } else if (pendingMigrations(sqlite) > 0) {
    sqlite.close();
    throw new Error("pending migrations; run `pnpm db:migrate`");
  }
  return db as ApiDb;
}

export function pendingMigrations(sqlite: Database.Database): number {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8")) as {
    entries: unknown[];
  };
  const hasTable = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get();
  if (!hasTable) return journal.entries.length;
  const applied = (
    sqlite.prepare("select count(*) as n from __drizzle_migrations").get() as { n: number }
  ).n;
  return Math.max(0, journal.entries.length - applied);
}
