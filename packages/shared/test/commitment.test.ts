import { describe, expect, it } from "vitest";
import {
  computeVerdictCommitment,
  canonicalHash,
  keccakBytes,
  type CommitmentInput,
} from "../src/index.js";

const base: CommitmentInput = {
  dispute_id: "d1",
  escrow_id: keccakBytes("e"),
  evidence_root: [keccakBytes("r2"), keccakBytes("r1")],
  rule_results: {
    evidence_valid: true,
    within_mandate: true,
    delivered: true,
    http_status: 200,
    within_sla: true,
    receipt_present: true,
    receipt_valid: true,
    schema_valid: true,
    schema_errors: [],
    fresh_by_timestamp: true,
    entity_match: "exact",
    injection_suspected: false,
    decisive: null,
  },
  claims: [{ text: "ok", cites: [4] }],
  models: [{ role: "judge", name: "m", version: "1" }],
  prompt_hash: keccakBytes("p"),
  settings_hash: canonicalHash({ temperature: 0, seed: 42 }),
  outcome: "RELEASE",
  fault: "NONE",
};

describe("computeVerdictCommitment", () => {
  it("is deterministic and independent of evidence_root order", () => {
    const a = computeVerdictCommitment(base);
    expect(a).toBe(
      computeVerdictCommitment({ ...base, evidence_root: [...base.evidence_root].reverse() }),
    );
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes when any committed input changes", () => {
    const a = computeVerdictCommitment(base);
    const variants: CommitmentInput[] = [
      { ...base, dispute_id: "d2" },
      { ...base, outcome: "REFUND" },
      { ...base, fault: "MERCHANT" },
      { ...base, claims: [{ text: "ok", cites: [5] }] },
      { ...base, rule_results: { ...base.rule_results, delivered: false } },
      { ...base, models: [{ role: "judge", name: "m", version: "2" }] },
      { ...base, prompt_hash: keccakBytes("p2") },
      { ...base, settings_hash: keccakBytes("s2") },
      { ...base, evidence_root: [keccakBytes("r1")] },
      { ...base, escrow_id: keccakBytes("e2") },
    ];
    for (const v of variants) expect(computeVerdictCommitment(v)).not.toBe(a);
  });
});
