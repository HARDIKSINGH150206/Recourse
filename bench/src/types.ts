import { z } from "zod";
import { TermsSchema } from "@recourse/shared";

/** Unix seconds the synthetic evidence starts at. */
export const T0 = 1_767_200_000;

/** Gateway timestamp of the `response` entry for a given latency (shared by generator and builder). */
export const responseTs = (latencyMs: number): number => T0 + 3 + Math.floor(latencyMs / 1000);

export const GENERATOR_VERSION = 1;

export const TruthSchema = z
  .object({
    label: z.enum(["REFUND", "RELEASE", "REVIEW"]),
    class: z.union([z.literal(3), z.literal(4)]).nullable(),
  })
  .strict();

/** One dispute case (docs/08 section 5.1). Ground truth is set by construction. */
export const BenchCaseSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    seed: z.number().int(),
    /** Paired controls (the same case without injected text) are not part of the 200 headline cases. */
    control: z.boolean(),
    pair_id: z.string().nullable(),
    mandate_terms: TermsSchema,
    request: z.object({ city: z.string() }).strict(),
    response: z
      .object({ status: z.number().int(), body: z.string(), latency_ms: z.number().int() })
      .strict(),
    receipt_mode: z.enum(["valid", "missing"]),
    owner_reason: z.string().nullable(),
    /** Flip a byte of the evidence after the bundle is built. */
    tamper: z.boolean(),
    truth: TruthSchema,
  })
  .strict();

export type BenchCase = z.infer<typeof BenchCaseSchema>;
export type Truth = z.infer<typeof TruthSchema>;
