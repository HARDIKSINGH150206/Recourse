import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAliasTable, type ModelsConfig } from "@recourse/adjudicator";
import {
  createLlm,
  createOllamaTransport,
  createOllamaVersionLookup,
  type LlmTransport,
} from "@recourse/llm";
import { generateCases } from "./generate.js";
import { percentile, summarize } from "./metrics.js";
import { prepareInputs, runConfig } from "./runner.js";
import { SEMANTIC_CATEGORIES } from "./metrics.js";
import type { BenchCase } from "./types.js";

/**
 * Spike S3 (docs/07 section 2, P2-01): which small Ollama models return reliable structured JSON on
 * the extractor and judge prompts, how accurate are they on cases the rules cannot decide, and how
 * fast are they on this machine?
 *
 *   pnpm --filter @recourse/bench spike -- model-a model-b model-c
 *
 * Each model plays both extractor and judge (config B) on 20 cases that must reach the AI: two from
 * each semantic category plus four owner-reason injections. This is a screening test on 20 cases,
 * not a benchmark: it can rule models out, not rank them precisely.
 */
export function spikeCases(all: BenchCase[]): BenchCase[] {
  const headline = all.filter((c) => !c.control);
  const pick = (cat: string, n: number) => headline.filter((c) => c.category === cat).slice(0, n);
  return [...SEMANTIC_CATEGORIES.flatMap((c) => pick(c, 2)), ...pick("inject_in_owner_reason", 4)];
}

export interface SpikeRow {
  model: string;
  cases: number;
  correct: number;
  abstained: number;
  structured_calls: number;
  raw_calls: number;
  /** Share of structured calls whose first reply was valid (no retry needed). */
  first_try_valid: number | null;
  warmup_ms: number;
  case_ms_p50: number | null;
  case_ms_p95: number | null;
  per_category: Record<string, string>;
}

function main(models: string[]) {
  return async () => {
    const aliasTable = loadAliasTable();
    const cases = spikeCases(generateCases(1));
    const inputs = await prepareInputs(cases);
    const rows: SpikeRow[] = [];

    for (const model of models) {
      let raw = 0;
      const base = createOllamaTransport();
      const counting: LlmTransport = (req) => {
        raw += 1;
        return base(req);
      };
      const llm = createLlm(counting, createOllamaVersionLookup());

      const w0 = performance.now();
      await base({
        model,
        system: "Reply with JSON.",
        user: '{"ok":true}',
        jsonSchema: { type: "object" },
        seed: 42,
        temperature: 0,
        top_p: 1,
        num_ctx: 4096,
        num_predict: 64,
        timeoutMs: 300_000,
      }).catch(() => undefined);
      const warmup = Math.round(performance.now() - w0);
      raw = 0;

      const cfg: ModelsConfig = {
        temperature: 0,
        seed: 42,
        top_p: 1,
        num_ctx: 4096,
        extractor: { name: model },
        judges: [{ name: model }],
      };
      let structured = 0;
      const run = await runConfig({
        config: "B",
        cases,
        inputs,
        llm,
        models: cfg,
        aliasTable,
        onCase: (r) => {
          structured += r.model_calls;
          console.log(
            `${model} ${r.id}: ${r.truth} -> ${r.predicted}${r.review_reason ? ` (${r.review_reason})` : ""} ${r.latency_ms} ms`,
          );
        },
      });
      const s = summarize(run.results);
      const times = run.results.map((r) => r.latency_ms);
      rows.push({
        model,
        cases: run.results.length,
        correct: s.overall_accuracy.k,
        abstained: s.abstain_rate.k,
        structured_calls: structured,
        raw_calls: raw,
        first_try_valid: structured === 0 ? null : 1 - Math.max(0, raw - structured) / structured,
        warmup_ms: warmup,
        case_ms_p50: percentile(times, 50),
        case_ms_p95: percentile(times, 95),
        per_category: Object.fromEntries(
          Object.entries(s.per_category).map(([k, v]) => [k, `${v.k}/${v.n}`]),
        ),
      });
    }

    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "results");
    mkdirSync(root, { recursive: true });
    const file = join(root, `spike-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        { created_at: new Date().toISOString(), cases: cases.map((c) => c.id), rows },
        null,
        2,
      ),
    );

    console.log(
      "\n| model | correct | abstained | first-try JSON valid | warm-up | case p50 | case p95 |",
    );
    console.log("|---|---|---|---|---|---|---|");
    for (const r of rows) {
      console.log(
        `| ${r.model} | ${r.correct}/${r.cases} | ${r.abstained} | ${r.first_try_valid === null ? "n/a" : `${(r.first_try_valid * 100).toFixed(0)}% of ${r.structured_calls} calls`} | ${r.warmup_ms} ms | ${r.case_ms_p50} ms | ${r.case_ms_p95} ms |`,
      );
    }
    console.log(`\nwrote ${file}`);
  };
}

if (process.argv[1] && process.argv[1].endsWith("spike.ts")) {
  const models = process.argv.slice(2).filter((a) => a !== "--");
  if (models.length === 0) throw new Error("usage: spike <ollama-model> [<ollama-model> ...]");
  await main(models)();
}
