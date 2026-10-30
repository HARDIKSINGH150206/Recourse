import { readFileSync } from "node:fs";
import { z } from "zod";

/** `config/models.json` (docs/08 section 4.1). Names are pinned by spike S3. */
export const ModelsConfigSchema = z
  .object({
    temperature: z.number(),
    seed: z.number().int(),
    top_p: z.number().default(1),
    num_ctx: z.number().int().positive().default(4096),
    extractor: z.object({ name: z.string().min(1) }).strict(),
    judges: z.array(z.object({ name: z.string().min(1) }).strict()).min(1),
  })
  .strict();

export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

const configPath = (file: string) => new URL(`../../../config/${file}`, import.meta.url);

export function loadModelsConfig(): ModelsConfig {
  return ModelsConfigSchema.parse(JSON.parse(readFileSync(configPath("models.json"), "utf8")));
}

export function loadAliasTable(): Record<string, string[]> {
  return z
    .record(z.array(z.string()))
    .parse(JSON.parse(readFileSync(configPath("alias-table.json"), "utf8")));
}

/** The settings that go into `settings_hash` (docs/03 section 10). */
export function settingsOf(cfg: ModelsConfig) {
  return { temperature: cfg.temperature, seed: cfg.seed, top_p: cfg.top_p, num_ctx: cfg.num_ctx };
}
