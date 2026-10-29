// pnpm db:migrate: apply pending migrations to data/api.db (or DB_DIR).
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@recourse/shared";
import { openDatabase } from "./client.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const cfg = loadConfig();
const path = resolve(root, cfg.DB_DIR, "api.db");
openDatabase(path, { migrations: "apply" }).$client.close();
console.log(`migrations applied to ${path}`);
