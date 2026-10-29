/** Pure decision logic of `pnpm demo`, kept separate so it is unit-tested. */

export type SceneResult = "PASS" | "FAIL" | "PENDING";

export interface DisputeView {
  status: string;
  note: string | null;
  verdict: {
    class: number | null;
    outcome: "REFUND" | "RELEASE" | null;
    fault: "NONE" | "AGENT" | "MERCHANT" | null;
    decided_by: string;
    injection_detected: boolean;
  } | null;
}

export interface Expectation {
  outcome: "REFUND" | "RELEASE";
  fault: "NONE" | "AGENT" | "MERCHANT";
  /** Allowed `decided_by` values; omitted means any. */
  decidedBy?: string[];
  injectionDetected?: boolean;
}

/** docs/05 section 2: what each disputed scene must end with. */
export const EXPECTED: Record<string, Expectation> = {
  wrong_schema: { outcome: "REFUND", fault: "MERCHANT", decidedBy: ["rules"] },
  stale_in_text: { outcome: "REFUND", fault: "MERCHANT", decidedBy: ["ai", "ai_quorum"] },
  injection: {
    outcome: "REFUND",
    fault: "MERCHANT",
    decidedBy: ["ai", "ai_quorum"],
    injectionDetected: true,
  },
  regret: { outcome: "RELEASE", fault: "NONE" },
};

export const TERMINAL = new Set(["resolved", "needs_human_review", "failed"]);

/** True when the AI lane's adjudicator is not installed: the API's stub always abstains with model_error. */
export function isStubAbstention(d: DisputeView): boolean {
  return (
    d.status === "needs_human_review" && /adjudicator abstained: model_error/.test(d.note ?? "")
  );
}

export function judgeDispute(
  scenario: string,
  d: DisputeView,
): { result: SceneResult; detail: string } {
  const want = EXPECTED[scenario];
  if (!want) return { result: "FAIL", detail: `no expectation for scenario ${scenario}` };
  if (isStubAbstention(d)) {
    return {
      result: "PENDING",
      detail:
        "adjudicator not installed yet (API stub abstained); evidence verified, awaiting the AI lane",
    };
  }
  if (d.status !== "resolved" || !d.verdict) {
    return { result: "FAIL", detail: `dispute ended ${d.status}${d.note ? `: ${d.note}` : ""}` };
  }
  const v = d.verdict;
  const problems: string[] = [];
  if (v.outcome !== want.outcome) problems.push(`outcome ${v.outcome}, expected ${want.outcome}`);
  if (v.fault !== want.fault) problems.push(`fault ${v.fault}, expected ${want.fault}`);
  if (want.decidedBy && !want.decidedBy.includes(v.decided_by))
    problems.push(`decided_by ${v.decided_by}, expected ${want.decidedBy.join(" or ")}`);
  if (want.injectionDetected !== undefined && v.injection_detected !== want.injectionDetected) {
    problems.push(`injection_detected ${v.injection_detected}, expected ${want.injectionDetected}`);
  }
  return problems.length > 0
    ? { result: "FAIL", detail: problems.join("; ") }
    : { result: "PASS", detail: `${v.outcome}/${v.fault} decided by ${v.decided_by}` };
}

/** Expected change of the merchant's reputation counters from the disputes that were resolved on-chain. */
export function expectedReputationDelta(
  resolved: Array<{ outcome: "REFUND" | "RELEASE"; fault: "NONE" | "AGENT" | "MERCHANT" }>,
) {
  return {
    disputes: resolved.length,
    merchantFaults: resolved.filter((r) => r.fault === "MERCHANT").length,
    agentFaults: resolved.filter((r) => r.fault === "AGENT").length,
  };
}

export function overall(results: SceneResult[], strict: boolean): number {
  if (results.includes("FAIL")) return 1;
  if (strict && results.includes("PENDING")) return 1;
  return 0;
}
