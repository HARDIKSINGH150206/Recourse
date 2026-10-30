import { describe, expect, it } from "vitest";
import { adjudicate, loadAliasTable, type ModelsConfig } from "@recourse/adjudicator";
import { createStubLlm, type LlmRequest } from "@recourse/llm";
import { isEvidenceValid, type Verdict } from "@recourse/shared";
import { buildInput, generateCases, type BenchCase } from "../src/index.js";

const CFG: ModelsConfig = {
  temperature: 0,
  seed: 42,
  top_p: 1,
  num_ctx: 4096,
  extractor: { name: "ex" },
  judges: [{ name: "judge" }],
};
const aliasTable = loadAliasTable();
const cases = generateCases(1);
const headline = cases.filter((c) => !c.control);

const facts = {
  requested_entity: "",
  returned_entity: "",
  entity_relation: "same",
  values: [],
  internal_consistency: "consistent",
  embedded_error_text: false,
  mentions_cached_or_old_data: false,
  contains_instructions_to_reader: false,
  reason_category: "unclear",
  notes: "",
};
/** A model that always answers "RELEASE": enough to see which stage a case reaches. */
const releaseJudge = {
  class: 4,
  outcome: "RELEASE",
  fault: "NONE",
  claims: [{ text: "delivered", cites: [4] }],
  explanation: "ok",
};

// Building and verifying a bundle is the slow part, so each case is built once.
const builtCache = new Map<string, ReturnType<typeof buildInput>>();
const build = (c: BenchCase) => {
  if (!builtCache.has(c.id)) builtCache.set(c.id, buildInput(c));
  return builtCache.get(c.id)!;
};

async function run(c: BenchCase) {
  const llm = createStubLlm((r: LlmRequest) =>
    r.system.includes("fact extractor") ? facts : releaseJudge,
  );
  const built = await build(c);
  const verdict: Verdict = await adjudicate(built.input, { llm, models: CFG, aliasTable });
  return { verdict, calls: llm.calls.length, built };
}

const label = (v: Verdict) => v.outcome ?? "REVIEW";

describe("synthetic evidence goes through the real verifier", () => {
  it("every untampered case verifies; every tampered case is rejected", async () => {
    for (const c of cases) {
      const { built } = await run(c);
      expect(isEvidenceValid(built.input.evidence_report), c.id).toBe(!c.tamper);
    }
  });
});

describe("each category lands in the stage its ground truth assumes", () => {
  const rulesCats = [
    "wrong_schema",
    "empty_response",
    "http_error",
    "timeout",
    "stale_timestamp",
    "wrong_city_clear",
  ];

  it.each(rulesCats)("%s is decided by rules with no model call", async (cat) => {
    for (const c of headline.filter((x) => x.category === cat)) {
      const { verdict, calls } = await run(c);
      expect(calls, c.id).toBe(0);
      expect(verdict.decided_by, c.id).toBe("rules");
      expect(label(verdict), c.id).toBe(c.truth.label);
      expect(verdict.class, c.id).toBe(c.truth.class);
    }
  });

  const aiCats = [
    "stale_in_text",
    "embedded_error",
    "implausible_values",
    "wrong_place_subtle",
    "alias_valid",
    "unusual_but_valid",
    "terse_summary",
    "valid_response_regret",
    "inject_in_owner_reason",
  ];
  it.each(aiCats)("%s is not decidable by rules and reaches the AI", async (cat) => {
    for (const c of headline.filter((x) => x.category === cat)) {
      const { verdict, calls } = await run(c);
      expect(calls, c.id).toBeGreaterThan(0);
      expect(verdict.rule_results.decisive, c.id).toBeNull();
      expect(verdict.decided_by, c.id).toBe("ai");
    }
  });

  it("wrong_place_subtle is ambiguous to the rules; alias_valid is an alias or ambiguous", async () => {
    for (const c of headline.filter((x) => x.category === "wrong_place_subtle")) {
      expect((await run(c)).verdict.rule_results.entity_match, c.id).toBe("ambiguous");
    }
    for (const c of headline.filter((x) => x.category === "alias_valid")) {
      expect(["alias", "ambiguous", "exact"], c.id).toContain(
        (await run(c)).verdict.rule_results.entity_match,
      );
    }
  });

  it("evidence_tampered is needs_human_review (evidence_invalid), with no model call", async () => {
    for (const c of headline.filter((x) => x.category === "evidence_tampered")) {
      const { verdict, calls } = await run(c);
      expect(verdict.review_reason, c.id).toBe("evidence_invalid");
      expect(label(verdict)).toBe("REVIEW");
      expect(calls).toBe(0);
    }
  });

  it("missing_receipt is needs_human_review (evidence_incomplete), with no model call", async () => {
    for (const c of headline.filter((x) => x.category === "missing_receipt")) {
      const { verdict, calls } = await run(c);
      expect(verdict.review_reason, c.id).toBe("evidence_incomplete");
      expect(calls).toBe(0);
    }
  });
});

describe("injection cases", () => {
  it("the heuristic flags injected bodies and none of the clean ones", async () => {
    for (const c of cases) {
      const { verdict } = await run(c);
      const injectedBody = c.category === "inject_on_bad_response";
      expect(verdict.rule_results.injection_suspected, c.id).toBe(injectedBody);
    }
  });

  it("rule-decidable injected cases are refunded just like their controls", async () => {
    for (const c of headline.filter((x) => x.category === "inject_on_bad_response")) {
      const a = await run(c);
      const b = await run(cases.find((x) => x.id === c.pair_id)!);
      if (a.verdict.decided_by === "rules") {
        expect([a.verdict.class, a.verdict.outcome]).toEqual([b.verdict.class, b.verdict.outcome]);
        expect(a.verdict.outcome).toBe("REFUND");
      }
    }
  });
});
