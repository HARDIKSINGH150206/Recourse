import { readFileSync } from "node:fs";
import { LlmError, jsonSchemaOf, type Llm } from "@recourse/llm";
import { RecourseError } from "@recourse/shared";
import { buildIntent } from "./intent.js";
import { LlmIntentSchema, type CompileContext, type CompiledIntent } from "./schema.js";

const MAX_TEXT_CHARS = 2000;

export const COMPILE_PROMPT = readFileSync(
  new URL("../prompts/compile.v1.md", import.meta.url),
  "utf8",
);

export interface CompilerOptions {
  llm: Llm;
  /** Ollama model name. Pinned in config by spike S3 (the adjudicator's extractor model is a fine choice). */
  model: string;
  seed?: number;
  temperature?: number;
  top_p?: number;
  num_ctx?: number;
}

/**
 * Natural language -> structured intent (M1, docs/04 section 3.1). The model only extracts; every
 * limit is validated in code (`buildIntent`) and the read-back the owner confirms is rendered by a
 * template, never by this model (D-015, M2). Throws `RecourseError`: `bad_request` when the owner
 * must state something, `upstream_error` when the model fails.
 */
export async function compileMandate(
  text: string,
  ctx: CompileContext,
  opts: CompilerOptions,
): Promise<CompiledIntent> {
  let intent;
  try {
    intent = await opts.llm.structuredChat({
      model: opts.model,
      system: COMPILE_PROMPT,
      user: JSON.stringify({ owner_request: text.slice(0, MAX_TEXT_CHARS) }),
      schema: LlmIntentSchema,
      jsonSchema: jsonSchemaOf(LlmIntentSchema),
      seed: opts.seed ?? 42,
      temperature: opts.temperature ?? 0,
      ...(opts.top_p !== undefined ? { top_p: opts.top_p } : {}),
      ...(opts.num_ctx !== undefined ? { num_ctx: opts.num_ctx } : {}),
    });
  } catch (err) {
    if (err instanceof LlmError) {
      throw new RecourseError("upstream_error", "the mandate compiler model is unavailable");
    }
    throw err;
  }
  return buildIntent(intent, ctx);
}

/** The object `apps/api` plugs in as its `MandateCompilerPort`. */
export function createMandateCompiler(opts: CompilerOptions) {
  return { compile: (text: string, ctx: CompileContext) => compileMandate(text, ctx, opts) };
}
