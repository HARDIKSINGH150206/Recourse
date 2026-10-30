import { ExtractedFactsSchema, type ExtractedFacts } from "@recourse/shared";
import { jsonSchemaOf, type Llm } from "@recourse/llm";
import type { ModelsConfig } from "./config.js";

/** Bounds keep the untrusted text inside the model context (docs/09 section 6). */
const MAX_BODY_CHARS = 3000;
const MAX_REASON_CHARS = 1000;

export interface Untrusted {
  requestedCity: string | undefined;
  bodyText: string;
  reasonText: string | null;
}

/**
 * Step 3 (docs/08 section 4.2): the ONLY place untrusted text reaches a model. The text travels
 * as JSON string values, never as prose, and the system prompt says it is data.
 */
export async function extractFacts(
  llm: Llm,
  cfg: ModelsConfig,
  systemPrompt: string,
  u: Untrusted,
): Promise<ExtractedFacts> {
  const user = JSON.stringify({
    requested_city: (u.requestedCity ?? "").slice(0, 100),
    response_body: u.bodyText.slice(0, MAX_BODY_CHARS),
    owner_reason: (u.reasonText ?? "").slice(0, MAX_REASON_CHARS),
  });
  return llm.structuredChat({
    model: cfg.extractor.name,
    system: systemPrompt,
    user,
    schema: ExtractedFactsSchema,
    jsonSchema: jsonSchemaOf(ExtractedFactsSchema),
    seed: cfg.seed,
    temperature: cfg.temperature,
    top_p: cfg.top_p,
    num_ctx: cfg.num_ctx,
  });
}
