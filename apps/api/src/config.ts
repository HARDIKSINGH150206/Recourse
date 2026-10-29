import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, requireAddress, requireKey, type Config } from "@recourse/shared";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export interface ApiConfig {
  cfg: Config;
  dbPath: string;
  arbiterKey: `0x${string}`;
  escrow: `0x${string}`;
  token: `0x${string}`;
}

/** Loads the root .env (if present) and validates everything the API needs; fails fast otherwise. */
export function loadApiConfig(): ApiConfig {
  try {
    process.loadEnvFile(resolve(REPO_ROOT, ".env"));
  } catch {
    // no .env: rely on the process environment
  }
  const cfg = loadConfig();
  return {
    cfg,
    dbPath: resolve(REPO_ROOT, cfg.DB_DIR, "api.db"),
    arbiterKey: requireKey(cfg, "ARBITER_PRIVATE_KEY"),
    escrow: requireAddress(cfg, "ESCROW_ADDRESS"),
    token: requireAddress(cfg, "TOKEN_ADDRESS"),
  };
}
