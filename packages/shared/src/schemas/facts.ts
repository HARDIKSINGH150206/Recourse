import { z } from "zod";

// Owned by P2 (D-024). Shape follows docs/08 section 4.2.
export const ExtractedFactsSchema = z
  .object({
    requested_entity: z.string(),
    returned_entity: z.string(),
    entity_relation: z.enum(["same", "alias", "different_place", "unknown"]),
    values: z.array(
      z.object({
        name: z.string(),
        value: z.union([z.number(), z.string()]),
        unit: z.string().optional(),
      }),
    ),
    internal_consistency: z.enum(["consistent", "contradictory", "placeholder_like"]),
    embedded_error_text: z.boolean(),
    mentions_cached_or_old_data: z.boolean(),
    contains_instructions_to_reader: z.boolean(),
    reason_category: z.enum(["objective_failure", "changed_mind", "unclear"]),
    notes: z.string().max(200),
  })
  .strict();
