// pnpm db:migrate: apply pending migrations to data/gateway.db (or DB_DIR).
import { join } from "node:path";
import { loadConfig } from "@recourse/shared";
import { openDatabase } from "./client.js";

const cfg = loadConfig();
const path = join(cfg.DB_DIR, "gateway.db");
openDatabase(path, { migrations: "apply" }).$client.close();
console.log(`migrations applied to ${path}`);
