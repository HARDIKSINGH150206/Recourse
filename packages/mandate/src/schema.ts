import { z } from "zod";

/** What the compile model returns. Nullable means "the owner did not say". */
export const LlmIntentSchema = z
  .object({
    category: z.string(),
    max_price_per_call: z.string().nullable(),
    total_budget: z.string().nullable(),
    duration_seconds: z.number().int().nullable(),
    freshness_seconds: z.number().int().nullable(),
    sla_ms: z.number().int().nullable(),
    schema_required: z.boolean().nullable(),
    substitutions: z.enum(["allowed", "not_allowed"]).nullable(),
    discretion: z.array(z.string()),
    questions: z.array(
      z.object({ id: z.string(), text: z.string(), options: z.array(z.string()) }).strict(),
    ),
  })
  .strict();

export type LlmIntent = z.infer<typeof LlmIntentSchema>;

type Address = `0x${string}`;

/** What `apps/api` expects from a mandate compiler (MandateCompilerPort in apps/api/src/ports.ts). */
export interface CompiledIntent {
  category: string;
  /** Decimal token units, for example "0.05". */
  maxPricePerCall: string;
  totalBudget: string;
  /** Unix seconds. */
  expiresAt: number;
  /** Always empty here: the caller's allowlist is used (the model never names merchants). */
  merchants: Address[];
  defaults?: {
    freshness_seconds?: number;
    schema_required?: boolean;
    substitutions?: "allowed" | "not_allowed";
    sla_ms?: number;
  };
  discretion?: string[];
  questions: { id: string; text: string; options: string[] }[];
}

export interface CompileContext {
  owner: Address;
  agent: Address;
  merchants: Address[];
  chainId: number;
  escrow: Address;
  token: Address;
  /** Unix seconds, injected. */
  now: number;
}
