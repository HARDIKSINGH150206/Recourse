import {
  ZERO32,
  canonicalHash,
  computeVerdictCommitment,
  type AdjudicationInput,
  type ExtractedFacts,
  type RuleResults,
  type Verdict,
} from "@recourse/shared";
import { settingsOf, type ModelsConfig } from "./config.js";

export const CLASS_NAMES = {
  1: "agent_exceeded_mandate",
  2: "agent_chose_unreasonably",
  3: "merchant_failure",
  4: "buyer_regret",
} as const;

type ReviewReason = NonNullable<Verdict["review_reason"]>;

export const REVIEW_TEXT: Record<ReviewReason, string> = {
  evidence_invalid: "The evidence did not verify, so a human must review this dispute.",
  evidence_incomplete: "The evidence is incomplete, so a human must review this dispute.",
  uncited_claims: "The decision could not be backed by log entries, so a human must review it.",
  no_quorum: "The judges did not agree, so a human must review this dispute.",
  model_error:
    "The AI stage failed to produce a usable result, so a human must review this dispute.",
};

export interface Ctx {
  input: AdjudicationInput;
  cfg: ModelsConfig;
  promptHash: `0x${string}`;
  rules: RuleResults;
  facts: ExtractedFacts | null;
  models: Verdict["models"];
}

type Decision = {
  class: 1 | 2 | 3 | 4;
  outcome: "REFUND" | "RELEASE";
  fault: "NONE" | "AGENT" | "MERCHANT";
  decided_by: Verdict["decided_by"];
  claims: Verdict["claims"];
  explanation: string;
};

function base(c: Ctx) {
  const { input } = c;
  return {
    dispute_id: input.dispute_id,
    escrow_id: input.escrow_id,
    rule_results: c.rules,
    facts: c.facts,
    injection_detected:
      c.rules.injection_suspected || c.facts?.contains_instructions_to_reader === true,
    evidence_root: input.bundle.tree_heads.map((h) => h.root),
    models: c.models,
    prompt_hash: c.promptHash,
    settings_hash: canonicalHash(settingsOf(c.cfg)),
    created_at: input.now,
  } as const;
}

export function decidedVerdict(c: Ctx, d: Decision): Verdict {
  const b = base(c);
  return {
    ...b,
    class: d.class,
    class_name: CLASS_NAMES[d.class],
    outcome: d.outcome,
    fault: d.fault,
    decided_by: d.decided_by,
    claims: d.claims,
    explanation: d.explanation,
    commitment: computeVerdictCommitment({
      dispute_id: b.dispute_id,
      escrow_id: b.escrow_id,
      rule_results: b.rule_results,
      claims: d.claims,
      models: b.models,
      prompt_hash: b.prompt_hash,
      settings_hash: b.settings_hash,
      evidence_root: b.evidence_root as readonly `0x${string}`[],
      outcome: d.outcome,
      fault: d.fault,
    }),
  };
}

/** `needs_human_review`: no outcome, no on-chain call, zero commitment (docs/08 section 4.6). */
export function reviewVerdict(c: Ctx, reason: ReviewReason): Verdict {
  return {
    ...base(c),
    class: null,
    class_name: null,
    outcome: null,
    fault: null,
    decided_by: "rules",
    claims: [],
    explanation: REVIEW_TEXT[reason],
    commitment: ZERO32,
    review_reason: reason,
  };
}
