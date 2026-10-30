import { describe, expect, it } from "vitest";
import { fmtCi, fmtRate } from "./bench";

describe("bench formatting", () => {
  it("always shows counts next to the percentage", () => {
    expect(fmtRate({ k: 18, n: 20, rate: 0.9, ci: [0.7, 0.97] })).toBe("18 of 20 (90%)");
    expect(fmtCi({ k: 18, n: 20, rate: 0.9, ci: [0.699, 0.97] })).toBe("95% CI 70–97%");
  });
  it("handles empty denominators and missing data", () => {
    expect(fmtRate({ k: 0, n: 0, rate: null, ci: null })).toBe("0 of 0");
    expect(fmtRate(undefined)).toBe("n/a");
    expect(fmtCi({ k: 0, n: 0, rate: null, ci: null })).toBe("");
  });
});
