import { z } from "zod";

// Owned by P2 (D-024). Shape follows docs/08 sections 2 and 3.
export const VerdictClassSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const OutcomeSchema = z.enum(["REFUND", "RELEASE"]);
export const FaultSchema = z.enum(["NONE", "AGENT", "MERCHANT"]);

export const DecisiveSchema = z
  .object({
    class: VerdictClassSchema,
    outcome: OutcomeSchema,
    fault: FaultSchema,
    reason: z.string(),
    cites: z.array(z.number().int().positive()),
  })
  .strict();

export const RuleResultsSchema = z
  .object({
    evidence_valid: z.boolean(),
    within_mandate: z.boolean(),
    delivered: z.boolean(),
    http_status: z.number().int().nullable(),
    within_sla: z.boolean(),
    receipt_present: z.boolean(),
    receipt_valid: z.boolean(),
    schema_valid: z.boolean(),
    schema_errors: z.array(z.string()),
    fresh_by_timestamp: z.boolean(),
    entity_match: z.enum(["exact", "alias", "different", "ambiguous"]),
    injection_suspected: z.boolean(),
    decisive: DecisiveSchema.nullable(),
  })
  .strict();
