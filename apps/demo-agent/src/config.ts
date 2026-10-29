import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadConfig, type Config } from "@recourse/shared";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const DemoConfigSchema = z
  .object({
    merchantId: z.string().default("weather"),
    city: z.string().default("Mumbai"),
    overCapAmount: z.string().default("0.50"),
  })
  .passthrough();
export type DemoConfig = z.infer<typeof DemoConfigSchema>;

export interface AgentConfig {
  cfg: Config;
  demo: DemoConfig;
}

export function loadAgentConfig(): AgentConfig {
  try {
    process.loadEnvFile(resolve(REPO_ROOT, ".env"));
  } catch {
    // no .env: rely on the process environment
  }
  return {
    cfg: loadConfig(),
    demo: DemoConfigSchema.parse(
      JSON.parse(readFileSync(resolve(REPO_ROOT, "config/demo.json"), "utf8")),
    ),
  };
}
