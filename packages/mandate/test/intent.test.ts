import { describe, expect, it } from "vitest";
import { RecourseError } from "@recourse/shared";
import { buildIntent, MAX_DURATION_SECONDS, type LlmIntent } from "../src/index.js";
import { good } from "./fixture.js";

const NOW = 1_767_200_000;
const build = (over: Partial<LlmIntent>) => buildIntent({ ...good, ...over }, { now: NOW });

function problems(over: Partial<LlmIntent>): string[] {
  try {
    build(over);
  } catch (e) {
    expect(e).toBeInstanceOf(RecourseError);
    expect((e as RecourseError).code).toBe("bad_request");
    return ((e as RecourseError).details?.missing as string[]) ?? [];
  }
  throw new Error("expected a rejection");
}

describe("buildIntent: the happy path", () => {
  it("computes expiresAt from the injected clock and leaves merchants to the caller", () => {
    expect(build({})).toEqual({
      category: "weather_data_api",
      maxPricePerCall: "0.05",
      totalBudget: "2.00",
      expiresAt: NOW + 86_400,
      merchants: [],
      defaults: {},
      discretion: [],
      questions: [],
    });
  });

  it("passes through only the defaults the owner stated", () => {
    const r = build({
      freshness_seconds: 1800,
      sla_ms: 2000,
      schema_required: false,
      substitutions: "allowed",
    });
    expect(r.defaults).toEqual({
      freshness_seconds: 1800,
      sla_ms: 2000,
      schema_required: false,
      substitutions: "allowed",
    });
  });

  it("accepts the boundary values", () => {
    expect(build({ duration_seconds: 60 }).expiresAt).toBe(NOW + 60);
    expect(build({ duration_seconds: MAX_DURATION_SECONDS }).expiresAt).toBe(
      NOW + MAX_DURATION_SECONDS,
    );
    expect(build({ max_price_per_call: "2.00" }).maxPricePerCall).toBe("2.00");
    expect(build({ freshness_seconds: 1, sla_ms: 1 }).defaults).toEqual({
      freshness_seconds: 1,
      sla_ms: 1,
    });
    expect(build({ freshness_seconds: 604_800, sla_ms: 600_000 }).defaults).toBeDefined();
  });

  it("normalises the category to snake_case", () => {
    expect(build({ category: " Weather Data API! " }).category).toBe("weather_data_api");
  });
});

describe("buildIntent: hard limits are never guessed", () => {
  it.each([
    ["no price", { max_price_per_call: null }, "a maximum price per call"],
    ["junk price", { max_price_per_call: "five cents" }, "a maximum price per call"],
    ["zero price", { max_price_per_call: "0.00" }, "a maximum price per call"],
    ["negative price", { max_price_per_call: "-1" }, "a maximum price per call"],
    ["exponent price", { max_price_per_call: "1e6" }, "a maximum price per call"],
    [
      "too many decimals",
      { max_price_per_call: "0.1234567890123456789" },
      "a maximum price per call",
    ],
    ["no budget", { total_budget: null }, "a total budget"],
    ["zero budget", { total_budget: "0" }, "a total budget"],
    ["no duration", { duration_seconds: null }, "how long"],
    ["duration too short", { duration_seconds: 59 }, "how long"],
    ["duration too long", { duration_seconds: MAX_DURATION_SECONDS + 1 }, "how long"],
    ["negative duration", { duration_seconds: -5 }, "how long"],
    ["empty category", { category: "!!!" }, "what is being bought"],
    ["freshness 0", { freshness_seconds: 0 }, "freshness"],
    ["freshness over 7 days", { freshness_seconds: 604_801 }, "freshness"],
    ["sla 0", { sla_ms: 0 }, "response-time"],
    ["sla over 10 minutes", { sla_ms: 600_001 }, "response-time"],
    [
      "price above budget",
      { max_price_per_call: "3", total_budget: "2" },
      "at least the maximum price",
    ],
  ] as [string, Partial<LlmIntent>, string][])("%s is rejected", (_n, over, text) => {
    expect(problems(over).join(" ")).toContain(text);
  });

  it("lists every missing item at once", () => {
    const p = problems({ max_price_per_call: null, total_budget: null, duration_seconds: null });
    expect(p).toHaveLength(3);
  });

  it("price equal to budget is allowed; price compared exactly, not as floats", () => {
    expect(build({ max_price_per_call: "2", total_budget: "2.000" }).totalBudget).toBe("2.000");
    expect(
      problems({ max_price_per_call: "0.30000000000000001", total_budget: "0.3" }),
    ).toHaveLength(1);
  });
});

describe("buildIntent: free-text outputs are bounded", () => {
  it("cleans, dedupes and caps discretion", () => {
    const r = build({
      discretion: ["Vendor Choice", "vendor_choice", "  ", "a", "b", "c", "d", "e", "f"],
    });
    expect(r.discretion).toEqual(["vendor_choice", "a", "b", "c", "d"]);
  });

  it("keeps well-formed questions and drops bad ones", () => {
    const r = build({
      questions: [
        { id: "Fees included?", text: "Is the budget inclusive of fees?", options: ["yes", "no"] },
        { id: "fees_included", text: "duplicate id", options: ["yes", "no"] },
        { id: "one_option", text: "only one option", options: ["yes"] },
        { id: "", text: "no id", options: ["a", "b"] },
        { id: "no_text", text: "   ", options: ["a", "b"] },
        { id: "long", text: "x".repeat(500), options: ["a ", " a", "b", "c", "d", "e"] },
      ],
    });
    expect(r.questions).toEqual([
      { id: "fees_included", text: "Is the budget inclusive of fees?", options: ["yes", "no"] },
      { id: "long", text: "x".repeat(300), options: ["a", "b", "c", "d"] },
    ]);
  });

  it("caps the number of questions", () => {
    const q = (i: number) => ({ id: `q${i}`, text: "t", options: ["a", "b"] });
    expect(build({ questions: [1, 2, 3, 4, 5].map(q) }).questions).toHaveLength(3);
  });
});
