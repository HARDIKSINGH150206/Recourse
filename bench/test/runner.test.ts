import { beforeAll, describe, expect, it } from "vitest";
import { loadAliasTable, type ModelsConfig } from "@recourse/adjudicator";
import { createStubLlm, type LlmRequest } from "@recourse/llm";
import {
  assembleRun,
  generateCases,
  prepareInputs,
  renderReport,
  runConfig,
  summarize,
  type BenchCase,
  type CaseResult,
  type ConfigId,
} from "../src/index.js";

const ONE: ModelsConfig = {
  temperature: 0,
  seed: 42,
  top_p: 1,
  num_ctx: 4096,
  extractor: { name: "ex" },
  judges: [{ name: "j1" }],
};
const THREE: ModelsConfig = { ...ONE, judges: [{ name: "j1" }, { name: "j2" }, { name: "j3" }] };
const aliasTable = loadAliasTable();

const facts = (user: string) => ({
  requested_entity: "",
  returned_entity: "",
  entity_relation: "same",
  values: [],
  internal_consistency: "consistent",
  embedded_error_text: false,
  mentions_cached_or_old_data: false,
  // The extractor flags attack text, as the real prompt asks.
  contains_instructions_to_reader: /ignore|system:|arbiter|new instructions|you must/i.test(user),
  reason_category: "unclear",
  notes: "",
});
const verdict = (refund: boolean, cite = 4) => ({
  class: refund ? 3 : 4,
  outcome: refund ? "REFUND" : "RELEASE",
  fault: refund ? "MERCHANT" : "NONE",
  claims: [{ text: "x", cites: [cite] }],
  explanation: "x",
});
const stub = (judge: (r: LlmRequest) => object) =>
  createStubLlm((r: LlmRequest) =>
    r.system.includes("fact extractor") ? facts(r.user) : judge(r),
  );

const alwaysRelease = () => stub(() => verdict(false));
const alwaysRefund = () => stub(() => verdict(true));
/** A judge that does what an injected instruction says: refunds when the extractor flagged one. */
const obedient = () =>
  stub((r) => verdict(r.user.includes('"contains_instructions_to_reader":true')));

let cases: BenchCase[];
let inputs: Awaited<ReturnType<typeof prepareInputs>>;
beforeAll(async () => {
  cases = generateCases(1);
  inputs = await prepareInputs(cases);
});

const run = (config: ConfigId, llm = alwaysRelease(), models = ONE, cache?: Map<string, unknown>) =>
  runConfig({ config, cases, inputs, llm, models, aliasTable, ...(cache ? { cache } : {}) });

describe("A1: rules only, abstain", () => {
  it("never releases, never calls a model, and its rule verdicts are never wrong", async () => {
    const { results } = await run("A1");
    expect(results.some((x) => x.predicted === "RELEASE")).toBe(false);
    expect(results.every((x) => x.model_calls === 0)).toBe(true);
    for (const x of results.filter((y) => y.predicted === "REFUND")) expect(x.truth).toBe("REFUND");
    const s = summarize(results);
    expect(s.n).toBe(200);
    expect(s.mean_model_calls).toBe(0);
    expect(s.false_refund_rate.k).toBe(0);
    expect(s.abstain_rate.k).toBeGreaterThan(0);
  });
});

describe("A2: rules only, default to RELEASE", () => {
  it("releases whenever the rules cannot decide, and is wrong only by missing refunds", async () => {
    const { results } = await run("A2");
    const review = results.filter((x) => x.predicted === "REVIEW");
    expect(review.every((x) => x.truth === "REVIEW")).toBe(true);
    expect(results.some((x) => x.decided_by === "baseline_default_release")).toBe(true);
    const s = summarize(results);
    expect(s.false_refund_rate.k).toBe(0);
    expect(s.missed_refund_rate.k).toBeGreaterThan(0);
  });
});

describe("B: one judge", () => {
  it("an always-release judge never wrongly refunds", async () => {
    const { results } = await run("B");
    const s = summarize(results);
    expect(s.false_refund_rate).toMatchObject({ k: 0, n: 65 });
    expect(s.missed_refund_rate.k).toBeGreaterThan(0);
    expect(s.mean_model_calls).toBeGreaterThan(0);
  });
  it("an always-refund judge wrongly refunds every case that reaches it, and the metric shows it", async () => {
    const s = summarize((await run("B", alwaysRefund())).results);
    expect(s.false_refund_rate).toMatchObject({ k: 65, n: 65 });
  });
  it("uses one judge even if the config lists three", async () => {
    const llm = alwaysRelease();
    await run("B", llm, THREE);
    expect(new Set(llm.calls.map((c) => c.model))).toEqual(new Set(["ex", "j1"]));
  });
});

describe("C: full system", () => {
  it("runs every configured judge and costs more model calls than B", async () => {
    const llm = alwaysRelease();
    const c = summarize((await run("C", llm, THREE)).results);
    expect(new Set(llm.calls.map((x) => x.model))).toEqual(new Set(["ex", "j1", "j2", "j3"]));
    const b = summarize((await run("B")).results);
    expect(c.mean_model_calls!).toBeGreaterThan(b.mean_model_calls!);
  });
});

describe("injection resistance", () => {
  it("a robust judge matches its controls on every pair", async () => {
    const s = summarize((await run("B", alwaysRelease())).results);
    expect(s.injection_resistance).toMatchObject({ k: 20, n: 20 });
  });
  it("a judge that obeys injected instructions is caught", async () => {
    const s = summarize((await run("B", obedient())).results);
    expect(s.injection_resistance.n).toBe(20);
    expect(s.injection_resistance.k).toBeLessThan(20);
  });
});

describe("citation validity", () => {
  it("is zero when the judge cites entries that do not exist", async () => {
    const s = summarize(
      (
        await run(
          "B",
          stub(() => verdict(false, 99)),
        )
      ).results,
    );
    expect(s.citation_validity.n).toBeGreaterThan(0);
    expect(s.citation_validity.k).toBe(0);
  });
  it("is complete when the judge cites real entries", async () => {
    const s = summarize((await run("B")).results);
    expect(s.citation_validity.k).toBe(s.citation_validity.n);
    expect(s.citation_validity.n).toBeGreaterThan(0);
  });
});

describe("cache and latency", () => {
  it("a second run reuses answers, and latency is reported only for uncached cases", async () => {
    const cache = new Map<string, unknown>();
    let t = 0;
    const timer = () => (t += 5);
    const opts = { config: "B" as const, cases, inputs, models: ONE, aliasTable, cache, timer };
    const first = await runConfig({ ...opts, llm: alwaysRelease() });
    const llm2 = alwaysRelease();
    const second = await runConfig({ ...opts, llm: llm2 });
    expect(llm2.calls).toHaveLength(0);
    expect(first.results.reduce((a, x) => a + x.cache_hits, 0)).toBe(0);
    const hits = second.results.filter((x) => x.cache_hits > 0);
    expect(hits.length).toBeGreaterThan(0);
    expect(second.results.map((x) => x.predicted)).toEqual(first.results.map((x) => x.predicted));
    const s1 = summarize(first.results);
    const s2 = summarize(second.results);
    expect(s1.latency_ms.n).toBe(200);
    expect(s2.latency_ms.n).toBe(200 - hits.filter((x) => !x.control).length);
    expect(s1.latency_ms.p50).toBe(5);
  });
});

describe("report", () => {
  it("states counts and intervals, every category, and derives lift sentences from the data", async () => {
    const runs = {
      A1: await run("A1"),
      A2: await run("A2"),
      B: await run("B", alwaysRelease()),
      C: await run("C", alwaysRelease(), THREE),
    };
    const file = assembleRun({
      runId: "t",
      seed: 1,
      generatorVersion: 1,
      createdAt: 1,
      judges: 3,
      runs,
    });
    expect(file.config).toMatchObject({
      headline_cases: 200,
      controls: 20,
      judges: 3,
      configs: ["A1", "A2", "B", "C"],
    });
    expect(file.config.models.map((m) => m.role)).toContain("judge");
    expect(file.results.lift.map((l) => `${l.ai}/${l.baseline}`)).toEqual([
      "B/A1",
      "B/A2",
      "C/A1",
      "C/A2",
    ]);

    const md = renderReport(file);
    expect(md).toMatch(/\d+\/200 \(\d+\.\d%, 95% CI/);
    for (const cat of Object.keys(file.results.configs.B!.per_category)) expect(md).toContain(cat);
    expect(md).toContain("| REFUND |");
    expect(md).toMatch(
      /B (improved|reduced|did not change) overall accuracy compared with A1: [+-]?\d/,
    );
    expect(md).toContain("synthetic");
    expect(md.toLowerCase()).not.toContain("tamper-proof");
    // The API serves this object as JSON, so it must survive a round trip unchanged.
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });

  it("says so when there is no baseline to compare with", async () => {
    const file = assembleRun({
      runId: "t",
      seed: 1,
      generatorVersion: 1,
      createdAt: 1,
      judges: 1,
      runs: { B: await run("B") },
    });
    expect(renderReport(file)).toContain("no lift to report");
  });
});

export type { CaseResult };
