import type { Address, Hex } from "viem";
import { canonicalHash } from "./hash.js";
import type { EvidenceBundle, MandateJson, Terms, VerificationReport, Verdict } from "./types.js";

/**
 * Everything the adjudicator receives for one dispute. Built by the API (apps/api); consumed by
 * `adjudicate()` in @recourse/adjudicator (docs/04 section 7, docs/08).
 *
 * Draft contract, agreed by the two lanes: change it through the interface-change process in
 * GUIDE.md section 4.2, not unilaterally.
 */
export interface AdjudicationInput {
  dispute_id: string;
  escrow_id: Hex;
  request_id: Hex;
  /** Bundle already fetched from the gateway. `evidence_report` is its verifyBundle result. */
  bundle: EvidenceBundle;
  evidence_report: VerificationReport;
  /** Raw response bodies keyed by body_hash; each was re-hashed and matches its key. */
  blobs: Record<string, Uint8Array>;
  /**
   * The owner's free-text dispute reason, or null. UNTRUSTED: it may go only to the extractor
   * model, never to a judge prompt (CLAUDE.md rule 3).
   */
  reason_text: string | null;
  mandate: { mandate: MandateJson; terms: Terms; merchants: Address[] };
  escrow: { amount: string; merchant: Address; createdAt: number; windowEnds: number };
  /** Unix seconds when adjudication started (injected clock). */
  now: number;
}

/** The adjudicator as the API sees it. */
export interface Adjudicator {
  adjudicate(input: AdjudicationInput): Promise<Verdict>;
}

export type CommitmentInput = Pick<
  Verdict,
  | "dispute_id"
  | "escrow_id"
  | "rule_results"
  | "claims"
  | "models"
  | "prompt_hash"
  | "settings_hash"
> & {
  evidence_root: readonly Hex[];
  outcome: "REFUND" | "RELEASE";
  fault: "NONE" | "AGENT" | "MERCHANT";
};

/**
 * Verdict commitment, docs/03 section 10: keccak256(JCS({...})) over the dispute, evidence root(s),
 * hashes of the rule results and claims, models, prompt and settings hashes, and the outcome.
 * Posted in `resolve(escrowId, outcome, fault, commitment)`. The API recomputes it and refuses to
 * resolve if the adjudicator's value differs.
 */
export function computeVerdictCommitment(v: CommitmentInput): Hex {
  return canonicalHash({
    dispute_id: v.dispute_id,
    escrow_id: v.escrow_id,
    evidence_root: [...v.evidence_root].sort(),
    rule_results_hash: canonicalHash(v.rule_results),
    claims_hash: canonicalHash(v.claims),
    models: v.models,
    prompt_hash: v.prompt_hash,
    settings_hash: v.settings_hash,
    outcome: v.outcome,
    fault: v.fault,
  });
}
