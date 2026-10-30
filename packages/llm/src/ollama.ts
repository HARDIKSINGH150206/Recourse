import { z } from "zod";
import { LlmError, createLlm, type Llm, type LlmTransport } from "./client.js";

export interface OllamaOptions {
  baseUrl?: string;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

const ChatResponse = z.object({ message: z.object({ content: z.string() }) });
const TagsResponse = z.object({
  models: z.array(z.object({ name: z.string(), digest: z.string() })),
});

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** Ollama `/api/chat` with structured output (`format` = JSON schema), non-streaming. */
export function createOllamaTransport(opts: OllamaOptions = {}): LlmTransport {
  const base = trimSlash(opts.baseUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434");
  const doFetch = opts.fetch ?? fetch;
  return async (req) => {
    let res: Response;
    try {
      res = await doFetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(req.timeoutMs),
        body: JSON.stringify({
          model: req.model,
          stream: false,
          format: req.jsonSchema,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          options: {
            temperature: req.temperature,
            seed: req.seed,
            top_p: req.top_p,
            num_ctx: req.num_ctx,
          },
        }),
      });
    } catch (err) {
      throw new LlmError("transport", `ollama request failed: ${(err as Error).name}`);
    }
    if (!res.ok) throw new LlmError("transport", `ollama returned HTTP ${res.status}`);
    const body = ChatResponse.safeParse(await res.json().catch(() => null));
    if (!body.success) throw new LlmError("transport", "ollama reply had an unexpected shape");
    return body.data.message.content;
  };
}

/** Model digest from `/api/tags`; this is the `version` recorded in the verdict's `models`. */
export function createOllamaVersionLookup(
  opts: OllamaOptions = {},
): (model: string) => Promise<string> {
  const base = trimSlash(opts.baseUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434");
  const doFetch = opts.fetch ?? fetch;
  return async (model) => {
    let res: Response;
    try {
      res = await doFetch(`${base}/api/tags`, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      throw new LlmError("transport", `ollama request failed: ${(err as Error).name}`);
    }
    if (!res.ok) throw new LlmError("transport", `ollama returned HTTP ${res.status}`);
    const tags = TagsResponse.safeParse(await res.json().catch(() => null));
    if (!tags.success) throw new LlmError("transport", "ollama reply had an unexpected shape");
    const hit = tags.data.models.find((m) => m.name === model || m.name === `${model}:latest`);
    if (!hit) throw new LlmError("transport", `model not installed: ${model}`);
    return hit.digest;
  };
}

export function createOllamaLlm(opts: OllamaOptions = {}): Llm {
  return createLlm(createOllamaTransport(opts), createOllamaVersionLookup(opts));
}
