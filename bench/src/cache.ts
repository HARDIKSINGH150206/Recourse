import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { keccakBytes } from "@recourse/shared";
import type { Llm, StructuredChatOptions } from "@recourse/llm";

/** Counts model calls that returned (cache hits included) and cache hits, for one case at a time. */
export interface Instrumented {
  llm: Llm;
  /** Reads and resets the counters. */
  take(): { calls: number; hits: number };
}

/**
 * Wraps a model client with an input-hash cache and call counters (docs/08 section 5.4). The key
 * covers everything that can change the output (model, both prompts, seed, sampling settings, the
 * output schema), so changing a prompt or a setting never reuses an old answer. A cached value is
 * re-validated with the caller's schema; one that no longer parses is treated as a miss.
 */
export function instrument(inner: Llm, store: Map<string, unknown> = new Map()): Instrumented {
  let calls = 0;
  let hits = 0;
  const llm: Llm = {
    modelVersion: (m) => inner.modelVersion(m),
    async structuredChat<T>(o: StructuredChatOptions<T>): Promise<T> {
      const key = keccakBytes(
        JSON.stringify([
          o.model,
          o.system,
          o.user,
          o.seed,
          o.temperature ?? 0,
          o.top_p ?? 1,
          o.num_ctx ?? 4096,
          o.jsonSchema,
        ]),
      );
      if (store.has(key)) {
        const parsed = o.schema.safeParse(store.get(key));
        if (parsed.success) {
          calls += 1;
          hits += 1;
          return parsed.data;
        }
      }
      const value = await inner.structuredChat(o);
      calls += 1; // counted only when the call returned
      store.set(key, value);
      return value;
    },
  };
  return {
    llm,
    take() {
      const out = { calls, hits };
      calls = 0;
      hits = 0;
      return out;
    },
  };
}

export function loadCache(path: string): Map<string, unknown> {
  if (!existsSync(path)) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>));
}

export function saveCache(path: string, store: Map<string, unknown>): void {
  writeFileSync(path, JSON.stringify(Object.fromEntries(store)));
}
