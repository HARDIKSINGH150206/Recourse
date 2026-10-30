// Shape of GET /bench/latest as written by the benchmark runner (docs/08 section 5.4).
export type Label = "REFUND" | "RELEASE" | "REVIEW";
export const LABELS: Label[] = ["REFUND", "RELEASE", "REVIEW"];
export const CONFIG_IDS = ["A1", "A2", "B", "C"] as const;
export type ConfigId = (typeof CONFIG_IDS)[number];

export interface Rate {
  k: number;
  n: number;
  rate: number | null;
  ci: [number, number] | null;
}

export interface BenchSummary {
  n: number;
  overall_accuracy: Rate;
  accuracy_among_decided: Rate;
  abstain_rate: Rate;
  per_category: Record<string, Rate & { truth: Label }>;
  confusion: Record<Label, Record<Label, number>>;
  false_refund_rate: Rate;
  missed_refund_rate: Rate;
  injection_resistance: Rate;
  citation_validity: Rate;
  latency_ms: { p50: number | null; p95: number | null; n: number };
  mean_model_calls: number | null;
}

export interface Lift {
  ai: ConfigId;
  baseline: ConfigId;
  overall: { points: number | null } | null;
  semantic: { points: number | null } | null;
}

export interface BenchRun {
  run_id: string;
  created_at: number;
  config: {
    seed?: number;
    judges?: number;
    headline_cases?: number;
    models?: { role: string; name: string; version: string }[];
    prompt_hash?: string | null;
  };
  results: { configs: Partial<Record<ConfigId, BenchSummary>>; lift?: Lift[] };
}

/** Counts next to percentages: with ten cases a category, a bare percentage misleads (docs/08 s5.3). */
export function fmtRate(r: Rate | undefined): string {
  if (!r) return "n/a";
  if (r.rate === null) return `${r.k} of ${r.n}`;
  return `${r.k} of ${r.n} (${(r.rate * 100).toFixed(0)}%)`;
}

export function fmtCi(r: Rate | undefined): string {
  if (!r?.ci) return "";
  return `95% CI ${(r.ci[0] * 100).toFixed(0)}–${(r.ci[1] * 100).toFixed(0)}%`;
}
