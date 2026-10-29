import { describe, expect, it } from "vitest";
import { expectedReputationDelta, judgeDispute, overall, type DisputeView } from "./demo-checks.js";

const resolved = (
  over: Partial<NonNullable<DisputeView["verdict"]>> = {},
  status = "resolved",
): DisputeView => ({
  status,
  note: null,
  verdict: {
    class: 3,
    outcome: "REFUND",
    fault: "MERCHANT",
    decided_by: "rules",
    injection_detected: false,
    ...over,
  },
});

describe("judgeDispute", () => {
  it("passes a verdict that matches the docs/05 expectation", () => {
    expect(judgeDispute("wrong_schema", resolved()).result).toBe("PASS");
    expect(judgeDispute("stale_in_text", resolved({ decided_by: "ai_quorum" })).result).toBe(
      "PASS",
    );
    expect(
      judgeDispute("injection", resolved({ decided_by: "ai", injection_detected: true })).result,
    ).toBe("PASS");
    expect(
      judgeDispute(
        "regret",
        resolved({ class: 4, outcome: "RELEASE", fault: "NONE", decided_by: "ai" }),
      ).result,
    ).toBe("PASS");
  });

  it("fails each way a verdict can be wrong, with the reason", () => {
    expect(
      judgeDispute("wrong_schema", resolved({ outcome: "RELEASE", fault: "NONE" })).detail,
    ).toMatch(/outcome RELEASE/);
    expect(judgeDispute("wrong_schema", resolved({ decided_by: "ai" })).detail).toMatch(
      /decided_by ai, expected rules/,
    );
    expect(
      judgeDispute("injection", resolved({ decided_by: "ai", injection_detected: false })).detail,
    ).toMatch(/injection_detected false/);
    expect(judgeDispute("regret", resolved()).result).toBe("FAIL");
  });

  it("reports the API stub's abstention as PENDING, not as a pass or a failure", () => {
    const stub: DisputeView = {
      status: "needs_human_review",
      note: "adjudicator abstained: model_error",
      verdict: null,
    };
    expect(judgeDispute("wrong_schema", stub).result).toBe("PENDING");
  });

  it("any other non-resolved ending is a failure, including a real abstention", () => {
    expect(
      judgeDispute("wrong_schema", { status: "failed", note: "commitment mismatch", verdict: null })
        .result,
    ).toBe("FAIL");
    expect(
      judgeDispute("wrong_schema", {
        status: "needs_human_review",
        note: "adjudicator abstained: no_quorum",
        verdict: null,
      }).result,
    ).toBe("FAIL");
    expect(
      judgeDispute("wrong_schema", {
        status: "needs_human_review",
        note: "evidence did not verify; not resolving on-chain",
        verdict: null,
      }).result,
    ).toBe("FAIL");
    expect(judgeDispute("unknown", resolved()).result).toBe("FAIL");
  });
});

describe("reputation and exit code", () => {
  it("counts disputes and faults per party", () => {
    expect(
      expectedReputationDelta([
        { outcome: "REFUND", fault: "MERCHANT" },
        { outcome: "REFUND", fault: "MERCHANT" },
        { outcome: "RELEASE", fault: "NONE" },
        { outcome: "REFUND", fault: "AGENT" },
      ]),
    ).toEqual({ disputes: 4, merchantFaults: 2, agentFaults: 1 });
  });

  it("fails on any FAIL, on PENDING only in strict mode", () => {
    expect(overall(["PASS", "PASS"], false)).toBe(0);
    expect(overall(["PASS", "PENDING"], false)).toBe(0);
    expect(overall(["PASS", "PENDING"], true)).toBe(1);
    expect(overall(["PASS", "FAIL", "PENDING"], false)).toBe(1);
  });
});
