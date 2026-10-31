import type { ZodType } from "zod";

/** Pinned generation settings (docs/08 section 4.1). Defaults are deterministic. */
/**
 * `num_predict` caps generated tokens. Every reply here is a small JSON object, and without a cap a
 * small model under constrained decoding can keep emitting tokens and never close it (seen in spike
 * S3: one call ran 15 minutes). A capped reply is truncated JSON, which fails validation like any
 * other bad output.
 */
export const DEFAULT_SETTINGS = {
  temperature: 0,
  top_p: 1,
  num_ctx: 4096,
  num_predict: 1024,
  timeoutMs: 120_000,
};

export interface StructuredChatOptions<T> {
  model: string;
  system: string;
  user: string;
  /** Validates every model output; the source of truth for the result type. */
  schema: ZodType<T>;
  /** Sent to the model as its output format (Ollama `format`). Must describe the same shape as `schema`. */
  jsonSchema: object;
  seed: number;
  temperature?: number;
  top_p?: number;
  num_ctx?: number;
  num_predict?: number;
  timeoutMs?: number;
}

/** What a transport receives: one fully specified model call, no zod types. */
export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  jsonSchema: object;
  seed: number;
  temperature: number;
  top_p: number;
  num_ctx: number;
  num_predict: number;
  timeoutMs: number;
}

/** Returns the raw text the model produced. Throws `LlmError` on transport failure. */
export type LlmTransport = (req: LlmRequest) => Promise<string>;

export interface Llm {
  structuredChat<T>(opts: StructuredChatOptions<T>): Promise<T>;
  /** Model digest or version string for the verdict commitment (docs/03 section 10). */
  modelVersion(model: string): Promise<string>;
}

export type LlmErrorCode = "transport" | "invalid_output";

/** The adjudicator maps any `LlmError` to `needs_human_review` (`model_error`). */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Longest model output we will parse (bounded input, docs/09 section 6). */
const MAX_OUTPUT_CHARS = 64_000;

function parseOutput<T>(
  raw: string,
  schema: ZodType<T>,
): { ok: true; value: T } | { ok: false; problem: string } {
  if (raw.length > MAX_OUTPUT_CHARS) return { ok: false, problem: "output too long" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, problem: "output was not valid JSON" };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, problem: `output failed schema validation: ${issues}` };
}

/**
 * Builds the client around a transport. Every output is validated with zod. On invalid JSON or a
 * schema failure the call is retried once with a short correction note; a second failure throws
 * `LlmError("invalid_output")` (docs/08 section 4.1). The note quotes only validator messages,
 * never model or user text.
 */
export function createLlm(
  transport: LlmTransport,
  versionOf: (model: string) => Promise<string> = async () => "unversioned",
): Llm {
  return {
    modelVersion: versionOf,
    async structuredChat<T>(opts: StructuredChatOptions<T>): Promise<T> {
      const base: LlmRequest = {
        model: opts.model,
        system: opts.system,
        user: opts.user,
        jsonSchema: opts.jsonSchema,
        seed: opts.seed,
        temperature: opts.temperature ?? DEFAULT_SETTINGS.temperature,
        top_p: opts.top_p ?? DEFAULT_SETTINGS.top_p,
        num_ctx: opts.num_ctx ?? DEFAULT_SETTINGS.num_ctx,
        num_predict: opts.num_predict ?? DEFAULT_SETTINGS.num_predict,
        timeoutMs: opts.timeoutMs ?? DEFAULT_SETTINGS.timeoutMs,
      };
      const first = parseOutput(await transport(base), opts.schema);
      if (first.ok) return first.value;

      const retry: LlmRequest = {
        ...base,
        user: `${base.user}\n\nYour previous reply was rejected: ${first.problem}. Reply again with only JSON matching the required schema.`,
      };
      const second = parseOutput(await transport(retry), opts.schema);
      if (second.ok) return second.value;
      throw new LlmError("invalid_output", second.problem);
    },
  };
}
