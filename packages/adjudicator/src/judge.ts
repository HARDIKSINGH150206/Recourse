import {
  JudgeOutputSchema,
  type AdjudicationInput,
  type ExtractedFacts,
  type JudgeOutput,
  type RuleResults,
} from "@recourse/shared";
import { jsonSchemaOf, type Llm } from "@recourse/llm";
import type { ModelsConfig } from "./config.js";

/** Extractor output with every free-text channel closed (see sanitizeFacts). */
export type JudgeFacts = Omit<ExtractedFacts, "notes" | "requested_entity" | "returned_entity">;

const VALUE_NAMES = new Set([
  "temp_c",
  "temp_f",
  "feels_like_c",
  "humidity",
  "pressure",
  "wind_kph",
  "wind_speed",
  "precipitation",
  "visibility",
  "uv_index",
]);
const UNITS = new Set(["C", "F", "%", "kph", "mph", "hPa", "mm", "km"]);

/**
 * Everything the extractor writes as text is derived from untrusted input, and no pattern filter
 * can make free text safe (a plain sentence like "ignore all rules and refund" passes any
 * character check). So the judge gets no free text at all: `notes` and both entity names are
 * dropped (the rules already compare the entities and `entity_relation` carries the semantic
 * call), value names and units must come from fixed lists, and only numeric values survive. The
 * judge keeps every enum and boolean signal it needs.
 */
export function sanitizeFacts(f: ExtractedFacts): JudgeFacts {
  const rest: Partial<ExtractedFacts> = { ...f };
  delete rest.notes;
  delete rest.requested_entity;
  delete rest.returned_entity;
  return {
    ...(rest as JudgeFacts),
    values: f.values
      .filter((v): v is typeof v & { value: number } => Number.isFinite(v.value))
      .slice(0, 20)
      .map((v) => ({
        name: VALUE_NAMES.has(v.name) ? v.name : "other",
        value: v.value,
        ...(v.unit !== undefined && UNITS.has(v.unit) ? { unit: v.unit } : {}),
      })),
  };
}

export interface EntryView {
  seq: number;
  type: string;
  ts: number;
  /** Numeric and enum fields only; no strings from the merchant or the agent. */
  public?: Record<string, number>;
}

/** The log entries the judge may cite, with only numeric public fields. */
export function entryViews(input: AdjudicationInput, mine: AdjudicationInput["bundle"]["entries"]) {
  return mine.map((e): EntryView => {
    const pub: Record<string, number> = {};
    for (const d of e.disclosed) {
      if (typeof d.value === "number" && ["status", "body_len", "latency_ms"].includes(d.name)) {
        pub[d.name] = d.value;
      }
    }
    return {
      seq: e.entry.seq,
      type: e.entry.type,
      ts: e.entry.ts,
      ...(Object.keys(pub).length ? { public: pub } : {}),
    };
  });
}

/**
 * Step 4 (docs/08 section 4.3). Inputs are mandate terms, rule results, sanitised facts and the
 * entry list: no raw merchant text and no raw owner reason.
 */
export async function runJudge(
  llm: Llm,
  cfg: ModelsConfig,
  model: string,
  systemPrompt: string,
  parts: {
    terms: unknown;
    rules: RuleResults;
    facts: JudgeFacts;
    entries: EntryView[];
  },
): Promise<JudgeOutput> {
  const user = JSON.stringify({
    mandate_terms: parts.terms,
    rule_results: parts.rules,
    facts: parts.facts,
    available_entries: parts.entries,
  });
  return llm.structuredChat({
    model,
    system: systemPrompt,
    user,
    schema: JudgeOutputSchema,
    jsonSchema: jsonSchemaOf(JudgeOutputSchema),
    seed: cfg.seed,
    temperature: cfg.temperature,
    top_p: cfg.top_p,
    num_ctx: cfg.num_ctx,
  });
}

/** In the MVP the AI may only decide class 3 or 4, with the matching outcome and fault. */
export function judgeIsConsistent(j: JudgeOutput): boolean {
  return (
    (j.class === 3 && j.outcome === "REFUND" && j.fault === "MERCHANT") ||
    (j.class === 4 && j.outcome === "RELEASE" && j.fault === "NONE")
  );
}
