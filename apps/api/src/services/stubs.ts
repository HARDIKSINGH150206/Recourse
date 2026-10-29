import {
  ZERO32,
  RecourseError,
  isEvidenceValid,
  type Adjudicator,
  type AdjudicationInput,
  type Verdict,
} from "@recourse/shared";
import type { CompiledIntent, MandateCompilerPort } from "../ports.js";

/**
 * Placeholder until @recourse/adjudicator lands (AI lane). It never decides: every dispute ends in
 * needs_human_review, so nothing is resolved on-chain by a stub.
 */
export class StubAdjudicator implements Adjudicator {
  async adjudicate(input: AdjudicationInput): Promise<Verdict> {
    return {
      dispute_id: input.dispute_id,
      escrow_id: input.escrow_id,
      class: null,
      class_name: null,
      outcome: null,
      fault: null,
      decided_by: "rules",
      rule_results: {
        evidence_valid: isEvidenceValid(input.evidence_report),
        within_mandate: false,
        delivered: false,
        http_status: null,
        within_sla: false,
        receipt_present: input.bundle.receipt !== null,
        receipt_valid: false,
        schema_valid: false,
        schema_errors: [],
        fresh_by_timestamp: false,
        entity_match: "ambiguous",
        injection_suspected: false,
        decisive: null,
      },
      facts: null,
      claims: [],
      explanation: "No adjudicator is installed (stub); a human must review this dispute.",
      injection_detected: false,
      evidence_root: input.bundle.tree_heads.map((h) => h.root),
      models: [],
      prompt_hash: ZERO32,
      settings_hash: ZERO32,
      commitment: ZERO32,
      review_reason: "model_error",
      created_at: input.now,
    };
  }
}

/** Placeholder until @recourse/mandate lands (AI lane). */
export class UnavailableCompiler implements MandateCompilerPort {
  compile(): Promise<CompiledIntent> {
    throw new RecourseError("not_implemented", "the mandate compiler is not installed yet");
  }
}
