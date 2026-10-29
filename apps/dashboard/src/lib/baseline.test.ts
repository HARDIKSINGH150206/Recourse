import { describe, expect, it } from "vitest";
import { delta, signed } from "./baseline";

describe("reputation delta", () => {
  it("is zero with no baseline and the difference with one", () => {
    expect(delta({ disputes: 3, faults: 1 }, null)).toEqual({ disputes: 0, faults: 0 });
    expect(delta({ disputes: 4, faults: 3 }, { disputes: 0, faults: 0 })).toEqual({
      disputes: 4,
      faults: 3,
    });
  });
  it("formats signs", () => {
    expect([signed(2), signed(0), signed(-1)]).toEqual(["+2", "0", "-1"]);
  });
});
