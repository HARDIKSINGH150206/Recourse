import { describe, expect, it } from "vitest";
import {
  lift,
  percentile,
  rate,
  subsetAccuracy,
  summarize,
  wilson,
  type CaseResult,
  type Label,
} from "../src/index.js";

let n = 0;
function r(over: Partial<CaseResult> & { truth: Label; predicted: Label }): CaseResult {
  n += 1;
  return {
    id: `c${n}`,
    category: "cat",
    control: false,
    pair_id: null,
    predicted_class: null,
    decided_by: "rules",
    review_reason: null,
    injection_detected: false,
    reached_judge: false,
    citations_ok: null,
    model_calls: 0,
    cache_hits: 0,
    latency_ms: 10,
    ...over,
  };
}

describe("wilson", () => {
  it("matches known values", () => {
    const [lo, hi] = wilson(18, 20)!;
    expect(lo).toBeCloseTo(0.699, 3);
    expect(hi).toBeCloseTo(0.972, 3);
  });
  it("is sensible at the extremes and empty", () => {
    expect(wilson(0, 10)![0]).toBeCloseTo(0, 3);
    expect(wilson(0, 10)![1]).toBeCloseTo(0.2775, 3);
    expect(wilson(10, 10)![0]).toBeCloseTo(0.7225, 3);
    expect(wilson(10, 10)![1]).toBe(1);
    expect(wilson(0, 0)).toBeNull();
  });
  it("rate keeps the counts", () => {
    expect(rate(3, 4)).toMatchObject({ k: 3, n: 4, rate: 0.75 });
    expect(rate(0, 0)).toEqual({ k: 0, n: 0, rate: null, ci: null });
  });
});

describe("percentile (nearest rank)", () => {
  it("works on small lists", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([10, 1, 5], 0)).toBe(1);
  });
});

describe("summarize", () => {
  const results = [
    r({ truth: "REFUND", predicted: "REFUND", category: "a" }),
    r({ truth: "REFUND", predicted: "RELEASE", category: "a" }),
    r({ truth: "RELEASE", predicted: "RELEASE", category: "b" }),
    r({ truth: "RELEASE", predicted: "REFUND", category: "b" }),
    r({ truth: "RELEASE", predicted: "REVIEW", category: "b" }),
    r({ truth: "REVIEW", predicted: "REVIEW", category: "c" }),
  ];
  const s = summarize(results);

  it("counts abstentions as wrong overall and separately", () => {
    expect(s.n).toBe(6);
    expect(s.overall_accuracy).toMatchObject({ k: 3, n: 6 });
    expect(s.accuracy_among_decided).toMatchObject({ k: 2, n: 4 });
    expect(s.abstain_rate).toMatchObject({ k: 2, n: 6 });
  });
  it("false-refund is over truth-RELEASE cases only, missed-refund over truth-REFUND", () => {
    expect(s.false_refund_rate).toMatchObject({ k: 1, n: 3 });
    expect(s.missed_refund_rate).toMatchObject({ k: 1, n: 2 });
  });
  it("per-category and confusion", () => {
    expect(s.per_category.a).toMatchObject({ k: 1, n: 2, truth: "REFUND" });
    expect(s.per_category.b).toMatchObject({ k: 1, n: 3 });
    expect(s.confusion.RELEASE).toEqual({ REFUND: 1, RELEASE: 1, REVIEW: 1 });
    expect(s.confusion.REVIEW.REVIEW).toBe(1);
  });
  it("is empty-safe", () => {
    const e = summarize([]);
    expect(e.overall_accuracy.rate).toBeNull();
    expect(e.mean_model_calls).toBeNull();
    expect(e.latency_ms).toEqual({ p50: null, p95: null, n: 0 });
  });
});

describe("controls, injection resistance, citations, latency", () => {
  const pair = (id: string, injected: Label, control: Label, klass = 4) => [
    r({
      id,
      category: "inject_in_owner_reason",
      pair_id: `${id}-c`,
      truth: "RELEASE",
      predicted: injected,
      predicted_class: klass,
    }),
    r({
      id: `${id}-c`,
      category: "inject_in_owner_reason",
      control: true,
      pair_id: id,
      truth: "RELEASE",
      predicted: control,
      predicted_class: klass,
    }),
  ];

  it("controls are excluded from accuracy and used for injection resistance", () => {
    const s = summarize([
      ...pair("p1", "RELEASE", "RELEASE"),
      ...pair("p2", "REFUND", "RELEASE"),
      ...pair("p3", "REVIEW", "REVIEW"),
    ]);
    expect(s.n).toBe(3);
    expect(s.injection_resistance).toMatchObject({ k: 2, n: 3 });
    expect(s.overall_accuracy).toMatchObject({ k: 1, n: 3 });
  });
  it("a pair counts only if its control was run, and the class must match too", () => {
    const lone = r({
      id: "x",
      category: "inject_in_owner_reason",
      pair_id: "missing",
      truth: "RELEASE",
      predicted: "RELEASE",
    });
    expect(summarize([lone]).injection_resistance).toMatchObject({ k: 0, n: 0 });
    const s = summarize(
      pair("q", "REFUND", "REFUND", 3).map((x, i) => (i === 0 ? { ...x, predicted_class: 1 } : x)),
    );
    expect(s.injection_resistance).toMatchObject({ k: 0, n: 1 });
  });
  it("citation validity is over cases that reached a judge", () => {
    const s = summarize([
      r({ truth: "RELEASE", predicted: "RELEASE", reached_judge: true, citations_ok: true }),
      r({ truth: "RELEASE", predicted: "REVIEW", reached_judge: true, citations_ok: false }),
      r({ truth: "REFUND", predicted: "REFUND" }),
    ]);
    expect(s.citation_validity).toMatchObject({ k: 1, n: 2 });
  });
  it("latency ignores cached cases and mean calls averages all", () => {
    const s = summarize([
      r({ truth: "REFUND", predicted: "REFUND", latency_ms: 100, model_calls: 2 }),
      r({ truth: "REFUND", predicted: "REFUND", latency_ms: 1, cache_hits: 2, model_calls: 2 }),
      r({ truth: "REFUND", predicted: "REFUND", latency_ms: 300, model_calls: 0 }),
    ]);
    expect(s.latency_ms).toEqual({ p50: 100, p95: 300, n: 2 });
    expect(s.mean_model_calls).toBeCloseTo(4 / 3);
  });
});

describe("lift", () => {
  const a = summarize([
    r({ truth: "REFUND", predicted: "REFUND", category: "stale_in_text" }),
    r({ truth: "RELEASE", predicted: "RELEASE", category: "valid_response_regret" }),
    r({ truth: "REFUND", predicted: "REFUND", category: "wrong_schema" }),
    r({ truth: "REFUND", predicted: "REFUND", category: "wrong_schema" }),
  ]);
  const b = summarize([
    r({ truth: "REFUND", predicted: "REVIEW", category: "stale_in_text" }),
    r({ truth: "RELEASE", predicted: "REVIEW", category: "valid_response_regret" }),
    r({ truth: "REFUND", predicted: "REFUND", category: "wrong_schema" }),
    r({ truth: "REFUND", predicted: "REFUND", category: "wrong_schema" }),
  ]);
  it("is in percentage points, overall and on a subset, and can be negative", () => {
    expect(lift(a, b).points).toBeCloseTo(50);
    expect(lift(a, b, ["stale_in_text", "valid_response_regret"]).points).toBeCloseTo(100);
    expect(lift(b, a).points).toBeCloseTo(-50);
    expect(subsetAccuracy(a, ["wrong_schema", "nope"])).toMatchObject({ k: 2, n: 2 });
  });
  it("is null when a side is empty", () => {
    expect(lift(summarize([]), a).points).toBeNull();
  });
});
