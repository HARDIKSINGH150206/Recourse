import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadConfig, requireAddress, requireKey, type Config } from "@recourse/shared";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const DemoConfig = z.object({ merchants: z.record(z.string().url()) }).passthrough();

export interface GatewayConfig {
  cfg: Config;
  dbPath: string;
  merchants: Record<string, string>;
  gatewayKey: `0x${string}`;
  escrow: `0x${string}`;
}

/** Loads the root .env (if present), validates env and reads the merchant registry. */
export function loadGatewayConfig(): GatewayConfig {
  try {
    process.loadEnvFile(resolve(REPO_ROOT, ".env"));
  } catch {
    // no .env: rely on the process environment
  }
  const cfg = loadConfig();
  const demo = DemoConfig.parse(
    JSON.parse(readFileSync(resolve(REPO_ROOT, "config/demo.json"), "utf8")),
  );
  return {
    cfg,
    dbPath: resolve(REPO_ROOT, cfg.DB_DIR, "gateway.db"),
    merchants: demo.merchants,
    gatewayKey: requireKey(cfg, "GATEWAY_PRIVATE_KEY"),
    escrow: requireAddress(cfg, "ESCROW_ADDRESS"),
  };
}
