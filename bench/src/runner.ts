import { adjudicate, type ModelsConfig } from "@recourse/adjudicator";
import { LlmError, type Llm } from "@recourse/llm";
import type { Verdict } from "@recourse/shared";
import { instrument } from "./cache.js";
import { buildInput, type BuiltCase } from "./evidence.js";
import type { CaseResult, ConfigId, Label } from "./metrics.js";
import type { BenchCase } from "./types.js";

/** Builds and verifies the evidence for every case once; the slow part, shared by all configs. */
export async function prepareInputs(cases: BenchCase[]): Promise<Map<string, BuiltCase>> {
  const out = new Map<string, BuiltCase>();
  for (const c of cases) out.set(c.id, await buildInput(c));
  return out;
}

/** A model that always fails: with it the real adjudicator is rules-only (configs A1 and A2). */
const noModel: Llm = {
  structuredChat: () =>
    Promise.reject(new LlmError("transport", "no model in a rules-only config")),
  modelVersion: () => Promise.reject(new LlmError("transport", "no model in a rules-only config")),
};

export interface RunOptions {
  config: ConfigId;
  cases: BenchCase[];
  inputs: Map<string, BuiltCase>;
  /** The real client, or a stub in tests. Ignored for A1 and A2. */
  llm: Llm;
  models: ModelsConfig;
  aliasTable: Record<string, string[]>;
  /** Shared output cache; pass the same Map across configs and runs to reuse answers. */
  cache?: Map<string, unknown>;
  /** Milliseconds, injectable for tests. */
  timer?: () => number;
  onCase?: (r: CaseResult) => void;
}

/**
 * The four ablation configurations (docs/08 section 5.2), all through the real adjudicator:
 * A1 rules only, abstain when no rule is decisive; A2 rules only, default to RELEASE; B rules plus
 * one judge; C the full system (every judge in the config, citation check, quorum).
 */
export async function runConfig(
  o: RunOptions,
): Promise<{ results: CaseResult[]; verdicts: Verdict[] }> {
  const timer = o.timer ?? (() => performance.now());
  const rulesOnly = o.config === "A1" || o.config === "A2";
  const models: ModelsConfig =
    o.config === "C" ? o.models : { ...o.models, judges: o.models.judges.slice(0, 1) };
  const inst = instrument(rulesOnly ? noModel : o.llm, o.cache);

  const results: CaseResult[] = [];
  const verdicts: Verdict[] = [];
  for (const c of o.cases) {
    const built = o.inputs.get(c.id);
    if (!built) throw new Error(`no prepared input for ${c.id}`);
    const t0 = timer();
    const verdict = await adjudicate(built.input, {
      llm: inst.llm,
      models,
      aliasTable: o.aliasTable,
    });
    const latency = Math.round(timer() - t0);
    const { calls, hits } = inst.take();

    let predicted: Label = verdict.outcome ?? "REVIEW";
    let klass = verdict.class;
    let decidedBy: string = verdict.decided_by;
    // A2 is the merchant-friendly baseline: where the rules cannot decide (the AI stage was reached
    // and failed, as it always does with no model), it releases.
    if (o.config === "A2" && verdict.review_reason === "model_error") {
      predicted = "RELEASE";
      klass = 4;
      decidedBy = "baseline_default_release";
    }

    const reached =
      verdict.decided_by === "ai" ||
      verdict.decided_by === "ai_quorum" ||
      verdict.review_reason === "uncited_claims" ||
      verdict.review_reason === "no_quorum";
    const seqs = new Set(built.bundle.entries.map((e) => e.entry.seq));
    const citesOk = verdict.claims.every(
      (cl) => cl.cites.length > 0 && cl.cites.every((s) => seqs.has(s)),
    );

    const r: CaseResult = {
      id: c.id,
      category: c.category,
      control: c.control,
      pair_id: c.pair_id,
      truth: c.truth.label,
      predicted,
      predicted_class: klass,
      decided_by: decidedBy,
      review_reason: verdict.review_reason ?? null,
      injection_detected: verdict.injection_detected,
      reached_judge: reached,
      citations_ok: reached ? citesOk && verdict.review_reason !== "uncited_claims" : null,
      model_calls: calls,
      cache_hits: hits,
      latency_ms: latency,
    };
    results.push(r);
    verdicts.push(verdict);
    o.onCase?.(r);
  }
  return { results, verdicts };
}
