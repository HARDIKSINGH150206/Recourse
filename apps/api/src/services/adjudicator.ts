import { createAdjudicator, loadModelsConfig, type ModelsConfig } from "@recourse/adjudicator";
import { createOllamaLlm } from "@recourse/llm";
import { createMandateCompiler } from "@recourse/mandate";
import type { Config } from "@recourse/shared";
import type { Logger } from "pino";

/** Model names pinned by spike S3 may still be the `TBD-` placeholders in config/models.json. */
export const isPlaceholder = (name: string) => name.startsWith("TBD");

/** Environment names (MODEL_EXTRACTOR, MODEL_JUDGE_1) take precedence over config/models.json. */
export function resolveModels(
  base: ModelsConfig,
  env: Pick<Config, "MODEL_EXTRACTOR" | "MODEL_JUDGE_1">,
): ModelsConfig {
  const [first, ...rest] = base.judges;
  return {
    ...base,
    extractor: { name: env.MODEL_EXTRACTOR ?? base.extractor.name },
    judges: [{ name: env.MODEL_JUDGE_1 ?? first!.name }, ...rest],
  };
}

/**
 * The real adjudicator and mandate compiler against the local Ollama server. Rule-decided
 * disputes never touch a model; when a model is needed and unavailable the pipeline ends in
 * needs_human_review, so a missing model or Ollama never produces a wrong on-chain resolution.
 */
export function buildAi(cfg: Config, logger: Logger) {
  const models = resolveModels(loadModelsConfig(), cfg);
  const names = [models.extractor.name, ...models.judges.map((j) => j.name)];
  if (names.some(isPlaceholder)) {
    logger.warn(
      "model names are still placeholders: set MODEL_EXTRACTOR and MODEL_JUDGE_1; disputes that need a model will go to human review and compiling will fail",
    );
  }
  const llm = createOllamaLlm({ baseUrl: cfg.OLLAMA_URL });
  return {
    adjudicator: createAdjudicator({ llm, models }),
    compiler: createMandateCompiler({
      llm,
      model: models.extractor.name,
      seed: models.seed,
      temperature: models.temperature,
      top_p: models.top_p,
      num_ctx: models.num_ctx,
    }),
  };
}
