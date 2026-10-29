import { z } from "zod";
import { Hex32, UnixSeconds } from "./common.js";
import { ExtractedFactsSchema } from "./facts.js";
import { FaultSchema, OutcomeSchema, RuleResultsSchema, VerdictClassSchema } from "./rules.js";

// Owned by P2 (D-024). Shape follows docs/08 sections 4.3 and 4.6.
export const ClaimSchema = z
  .object({ text: z.string().min(1), cites: z.array(z.number().int().positive()) })
  .strict();

export const JudgeOutputSchema = z
  .object({
    class: VerdictClassSchema,
    outcome: OutcomeSchema,
    fault: FaultSchema,
    claims: z.array(ClaimSchema),
    explanation: z.string(),
  })
  .strict();

export const ReviewReasonSchema = z.enum([
  "evidence_invalid",
  "evidence_incomplete",
  "uncited_claims",
  "no_quorum",
  "model_error",
]);

export const VerdictSchema = z
  .object({
    dispute_id: z.string(),
    escrow_id: Hex32,
    class: VerdictClassSchema.nullable(),
    class_name: z.string().nullable(),
    outcome: OutcomeSchema.nullable(),
    fault: FaultSchema.nullable(),
    decided_by: z.enum(["rules", "ai", "ai_quorum", "human"]),
    rule_results: RuleResultsSchema,
    facts: ExtractedFactsSchema.nullable(),
    claims: z.array(ClaimSchema),
    explanation: z.string(),
    injection_detected: z.boolean(),
    evidence_root: z.array(Hex32),
    models: z.array(z.object({ role: z.string(), name: z.string(), version: z.string() })),
    prompt_hash: Hex32,
    settings_hash: Hex32,
    commitment: Hex32,
    review_reason: ReviewReasonSchema.optional(),
    created_at: UnixSeconds,
  })
  .strict();
