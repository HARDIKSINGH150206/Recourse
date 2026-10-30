import { describe, expect, it } from "vitest";
import { SEMANTIC_CATEGORIES } from "../src/index.js";
import { generateCases } from "../src/index.js";
import { spikeCases } from "../src/spike.js";

describe("spike cases", () => {
  const cases = spikeCases(generateCases(1));
  it("are 20 cases that all reach the AI: two per semantic category plus four owner-reason injections", () => {
    expect(cases).toHaveLength(20);
    for (const c of SEMANTIC_CATEGORIES)
      expect(cases.filter((x) => x.category === c)).toHaveLength(2);
    expect(cases.filter((x) => x.category === "inject_in_owner_reason")).toHaveLength(4);
    expect(cases.some((c) => c.control || c.tamper || c.receipt_mode === "missing")).toBe(false);
  });
});
